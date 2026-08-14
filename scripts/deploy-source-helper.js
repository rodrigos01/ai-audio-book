const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

// Some sandboxes (e.g. Claude Code cloud sessions) set a placeholder
// CLOUDSDK_AUTH_ACCESS_TOKEN meant for their own proxied Google API calls.
// gcloud prefers that over an explicitly activated service account, which
// breaks auth for deploys against an arbitrary GCP project. Clear it so
// `gcloud auth activate-service-account` (or ADC) is used instead.
delete process.env.CLOUDSDK_AUTH_ACCESS_TOKEN;

const PROJECT = 'ai-audio-book';
const REGION = 'us-central1';
const RUNTIME_SERVICE_ACCOUNT = 'player@ai-audio-book.iam.gserviceaccount.com';
const STORAGE_BUCKET = 'ai-audio-book-storage-ai-audio-book';

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      let key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  });
  return env;
}

function loadConfig(rootDir) {
  const frontendEnv = loadEnv(path.join(rootDir, 'frontend/.env'));
  const backendEnv = loadEnv(path.join(rootDir, 'backend/.env'));
  const rootEnv = loadEnv(path.join(rootDir, '.env'));
  return { ...frontendEnv, ...backendEnv, ...rootEnv, ...process.env };
}

// Cloud Build's built-in $BRANCH_NAME substitution used by cloudbuild.yaml is only
// populated when a build is triggered from a connected repo -- it's empty for a
// manual `gcloud builds submit`/`gcloud run deploy --source`. Compute the prefix
// straight from git instead, so this works the same everywhere.
function getCurrentBranch() {
  // actions/checkout leaves the repo in a detached HEAD state, so
  // `git rev-parse --abbrev-ref HEAD` would return the literal string "HEAD"
  // in GitHub Actions, not the branch name. GITHUB_REF_NAME is GitHub's own
  // answer to "what branch is this" and takes precedence when present.
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
}

function getBranchServicePrefix() {
  const branch = getCurrentBranch();
  if (branch === 'master') return '';
  const sanitized = branch
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${sanitized}-`;
}

// Claude Code cloud sessions get a fresh, disposable container per session,
// so a branch-prefixed service would pile up a new pair of Cloud Run services
// (and need manual teardown) every time an agent runs this. Point them at
// the one persistent claude-develop-* pair instead, so repeated agent runs
// redeploy the same known URL rather than minting new ones.
const CLAUDE_DEV_SERVICE_PREFIX = 'claude-develop-';

function getDefaultServicePrefix() {
  if (process.env.CLAUDE_CODE_REMOTE === 'true') return CLAUDE_DEV_SERVICE_PREFIX;
  return getBranchServicePrefix();
}

// Resolves the service name to deploy: an explicit override if one was
// passed (e.g. a CLI arg), otherwise the default prefix (claude-develop-* in
// Claude Code cloud sessions, branch-derived everywhere else) plus suffix.
function resolveServiceName(explicitName, suffix) {
  if (explicitName) return explicitName;
  return `${getDefaultServicePrefix()}${suffix}`;
}

function runGcloud(args, label) {
  console.log(`\n--- ${label} ---`);
  console.log(`gcloud ${args.join(' ')}\n`);
  const result = spawnSync('gcloud', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

// backend/Dockerfile and frontend/Dockerfile assume a repo-root build context
// (they COPY "backend/..." / "frontend/..."), matching how cloudbuild.yaml
// invokes `docker build -f backend/Dockerfile .`. `gcloud run deploy --source`
// has no way to decouple the Dockerfile's location from its build context, so
// it can't use those directly. Stage a clean copy of the subdir instead (minus
// node_modules/.env/credentials) with the self-contained Dockerfile.source
// copied in as `Dockerfile`.
const STAGE_SKIP_NAMES = new Set(['node_modules', '.env', '.git', 'dist', '.gcloudignore', 'Dockerfile.source']);

function stageDirCopy(rootDir, subdir) {
  const srcDir = path.join(rootDir, subdir);
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), `deploy-source-${subdir}-`));
  fs.cpSync(srcDir, stageDir, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (STAGE_SKIP_NAMES.has(base)) return false;
      if (base.startsWith('ai-audio-book-') && base.endsWith('.json')) return false;
      return true;
    }
  });
  return { srcDir, stageDir };
}

function stageSourceDir(rootDir, subdir) {
  const { srcDir, stageDir } = stageDirCopy(rootDir, subdir);
  fs.copyFileSync(path.join(srcDir, 'Dockerfile.source'), path.join(stageDir, 'Dockerfile'));
  return stageDir;
}

// `gcloud run deploy --source` does NOT pass --set-build-env-vars through as
// `docker build --build-arg` for Dockerfile-based builds (verified against
// the actual Cloud Build step it generates -- no --build-arg flags appear).
// So instead of relying on ARG defaults coming from the build invocation,
// bake the resolved values directly into `ARG NAME=value` lines when staging
// the Dockerfile. Dockerfile.source keeps bare `ARG NAME` (no default) as
// the readable template; this rewrites just those lines per deploy.
function stageFrontendSourceDir(rootDir, buildVars) {
  const { srcDir, stageDir } = stageDirCopy(rootDir, 'frontend');
  let dockerfile = fs.readFileSync(path.join(srcDir, 'Dockerfile.source'), 'utf-8');
  for (const [name, value] of Object.entries(buildVars)) {
    const escaped = String(value).replace(/"/g, '\\"');
    dockerfile = dockerfile.replace(
      new RegExp(`^ARG ${name}$`, 'm'),
      `ARG ${name}="${escaped}"`
    );
  }
  fs.writeFileSync(path.join(stageDir, 'Dockerfile'), dockerfile);
  return stageDir;
}

// `gcloud run deploy --source` always passes --no-cache to the underlying
// `docker build` (verified against the actual Cloud Build step it
// generates), and each Cloud Build run happens on a fresh, ephemeral VM
// anyway -- so even without --no-cache there'd be nothing to reuse across
// separate deploys. That makes `RUN npm install` re-run from scratch on
// every single deploy regardless of whether package.json changed, which is
// the slow part.
//
// Build+push via Kaniko instead, with its registry-based layer cache
// (--cache=true): Kaniko stores each layer's digest in the destination
// registry and reuses it on a later build if the layer's inputs (preceding
// Dockerfile instructions + their context) are unchanged, so an unchanged
// `COPY package*.json ./` + `RUN npm install` pair is skipped entirely on
// repeat deploys instead of reinstalling every dependency every time.
const CACHE_TTL = '336h'; // 14 days
const ARTIFACT_REPO = 'cloud-run-source-deploy';

function getImageTag(serviceName) {
  return `${REGION}-docker.pkg.dev/${PROJECT}/${ARTIFACT_REPO}/${serviceName}:latest`;
}

function buildAndPushImage(stageDir, serviceName) {
  const imageTag = getImageTag(serviceName);
  const cloudbuildYaml = `
steps:
  - name: 'gcr.io/kaniko-project/executor:latest'
    args:
      - --dockerfile=Dockerfile
      - --destination=${imageTag}
      - --cache=true
      - --cache-ttl=${CACHE_TTL}
options:
  logging: CLOUD_LOGGING_ONLY
`;
  fs.writeFileSync(path.join(stageDir, 'cloudbuild.yaml'), cloudbuildYaml);

  runGcloud([
    'builds', 'submit', stageDir,
    '--config', path.join(stageDir, 'cloudbuild.yaml'),
    '--project', PROJECT
  ], `Building image for ${serviceName} (Kaniko, cached)`);

  return imageTag;
}

function getServiceUrl(serviceName) {
  return execFileSync('gcloud', [
    'run', 'services', 'describe', serviceName,
    '--region', REGION,
    '--project', PROJECT,
    '--format', 'value(status.url)'
  ], { encoding: 'utf-8' }).trim();
}

// Split out from deployBackend so the GitHub Actions path (which builds via
// Docker Buildx directly on the runner, not Kaniko/Cloud Build -- see
// .github/workflows/deploy.yml) can reuse the exact same deploy flags
// without duplicating them.
function deployBackendImage(backendService, imageTag, config) {
  const envVars = [
    'STORAGE_BASE_PATH=/app/storage',
    // Overrides the Dockerfile's baked-in GOOGLE_APPLICATION_CREDENTIALS path
    // (a key file this source-based deploy never bakes into the image) so the
    // app's own fallback logic picks up Application Default Credentials via
    // the attached runtime service account instead of trying to read a file
    // that doesn't exist.
    'GOOGLE_APPLICATION_CREDENTIALS=',
    'NODE_ENV=production',
    `GOOGLE_CLOUD_PROJECT=${PROJECT}`,
    `GEMINI_API_KEY=${config.GEMINI_API_KEY || ''}`
  ].join(',');

  runGcloud([
    'run', 'deploy', backendService,
    '--image', imageTag,
    '--project', PROJECT,
    '--region', REGION,
    '--platform', 'managed',
    '--allow-unauthenticated',
    '--execution-environment', 'gen2',
    '--service-account', RUNTIME_SERVICE_ACCOUNT,
    '--add-volume', `name=storage-volume,type=cloud-storage,bucket=${STORAGE_BUCKET}`,
    '--add-volume-mount', 'volume=storage-volume,mount-path=/app/storage',
    '--set-env-vars', envVars
  ], `Deploying backend (${backendService})`);

  return getServiceUrl(backendService);
}

function deployBackend(rootDir, config, backendService) {
  const stageDir = stageSourceDir(rootDir, 'backend');
  let imageTag;
  try {
    imageTag = buildAndPushImage(stageDir, backendService);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  return deployBackendImage(backendService, imageTag, config);
}

function getFrontendBuildVars(config, backendUrl) {
  return {
    VITE_FIREBASE_API_KEY: config.VITE_FIREBASE_API_KEY || '',
    VITE_FIREBASE_AUTH_DOMAIN: config.VITE_FIREBASE_AUTH_DOMAIN || '',
    VITE_FIREBASE_PROJECT_ID: config.VITE_FIREBASE_PROJECT_ID || '',
    VITE_FIREBASE_STORAGE_BUCKET: config.VITE_FIREBASE_STORAGE_BUCKET || '',
    VITE_FIREBASE_MESSAGING_SENDER_ID: config.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    VITE_FIREBASE_APP_ID: config.VITE_FIREBASE_APP_ID || '',
    VITE_GOOGLE_CLIENT_ID: config.VITE_GOOGLE_CLIENT_ID || '',
    VITE_API_BASE_URL: `${backendUrl}/api`
  };
}

// Split out from deployFrontend for the same reason as deployBackendImage.
function deployFrontendImage(frontendService, imageTag) {
  runGcloud([
    'run', 'deploy', frontendService,
    '--image', imageTag,
    '--project', PROJECT,
    '--region', REGION,
    '--platform', 'managed',
    '--allow-unauthenticated'
  ], `Deploying frontend (${frontendService})`);

  return getServiceUrl(frontendService);
}

function deployFrontend(rootDir, config, frontendService, backendUrl) {
  const buildVars = getFrontendBuildVars(config, backendUrl);

  const stageDir = stageFrontendSourceDir(rootDir, buildVars);
  let imageTag;
  try {
    imageTag = buildAndPushImage(stageDir, frontendService);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  return deployFrontendImage(frontendService, imageTag);
}

function updateBackendCors(backendService, frontendUrl) {
  runGcloud([
    'run', 'services', 'update', backendService,
    '--project', PROJECT,
    '--region', REGION,
    '--update-env-vars', `ALLOWED_ORIGINS=${frontendUrl}`
  ], `Updating backend CORS (${backendService})`);
}

module.exports = {
  PROJECT,
  REGION,
  loadConfig,
  getBranchServicePrefix,
  resolveServiceName,
  deployBackend,
  deployFrontend,
  updateBackendCors,
  getServiceUrl,
  // Exposed for the GitHub Actions path (.github/workflows/deploy.yml +
  // scripts/actions-deploy.js), which builds via Docker Buildx directly on
  // the runner instead of Kaniko/Cloud Build, but reuses everything else.
  stageSourceDir,
  stageFrontendSourceDir,
  getFrontendBuildVars,
  getImageTag,
  deployBackendImage,
  deployFrontendImage
};
