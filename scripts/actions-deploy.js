// Used only by .github/workflows/deploy.yml. Unlike the interactive
// deploy-source scripts (which build via Kaniko/Cloud Build because the
// environments they run in -- Claude Code cloud sessions -- have no Docker
// daemon), GitHub-hosted runners do have one, so the workflow builds
// directly with Docker Buildx and its native GitHub Actions cache backend
// instead: no Cloud Build provisioning latency, no Kaniko executor image
// pull, no GCS source-upload round trip. This script only handles the parts
// around that build step (staging the Dockerfile context, and deploying an
// already-built image) via scripts/deploy-source-helper.js, so both paths
// share the same service-naming, staging, and gcloud-deploy logic.
const fs = require('fs');
const path = require('path');
const {
  loadConfig,
  resolveServiceName,
  stageSourceDir,
  stageFrontendSourceDir,
  getFrontendBuildVars,
  getImageTag,
  deployBackendImage,
  deployFrontendImage,
  updateBackendCors
} = require('./deploy-source-helper');

const rootDir = path.resolve(__dirname, '..');

function writeOutput(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) throw new Error('GITHUB_OUTPUT is not set -- this script is meant to run as a GitHub Actions step');
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n');
  fs.appendFileSync(file, lines + '\n');
  console.log(values);
}

const [, , command, ...args] = process.argv;

switch (command) {
  case 'stage-backend': {
    const [serviceOverride] = args;
    const service = resolveServiceName(serviceOverride, 'ai-audio-book-api');
    const dir = stageSourceDir(rootDir, 'backend');
    writeOutput({ service, dir, image: getImageTag(service) });
    break;
  }

  case 'stage-frontend': {
    const [backendUrl, serviceOverride] = args;
    if (!backendUrl) throw new Error('Usage: stage-frontend <backend-url> [service-override]');
    const config = loadConfig(rootDir);
    const service = resolveServiceName(serviceOverride, 'ai-audio-book');
    const buildVars = getFrontendBuildVars(config, backendUrl);
    const dir = stageFrontendSourceDir(rootDir, buildVars);
    writeOutput({ service, dir, image: getImageTag(service) });
    break;
  }

  case 'deploy-backend': {
    const [service, image] = args;
    if (!service || !image) throw new Error('Usage: deploy-backend <service> <image>');
    const config = loadConfig(rootDir);
    const url = deployBackendImage(service, image, config);
    writeOutput({ url });
    break;
  }

  case 'deploy-frontend': {
    const [service, image] = args;
    if (!service || !image) throw new Error('Usage: deploy-frontend <service> <image>');
    const url = deployFrontendImage(service, image);
    writeOutput({ url });
    break;
  }

  case 'cors': {
    const [backendService, frontendUrl] = args;
    if (!backendService || !frontendUrl) throw new Error('Usage: cors <backend-service> <frontend-url>');
    updateBackendCors(backendService, frontendUrl);
    break;
  }

  default:
    throw new Error(`Unknown command: ${command}. Expected one of: stage-backend, stage-frontend, deploy-backend, deploy-frontend, cors`);
}
