const path = require('path');
const { loadConfig, resolveServiceName, deployFrontend, getServiceUrl, updateBackendCors } = require('../../scripts/deploy-source-helper');

// Usage: npm run deploy-source-frontend -- [frontend-service-name] [backend-service-name]
// Defaults to claude-develop-ai-audio-book(-api) in Claude Code cloud sessions,
// or branch-derived names everywhere else -- see resolveServiceName.
const rootDir = path.resolve(__dirname, '../..');
const config = loadConfig(rootDir);
const frontendService = resolveServiceName(process.argv[2], 'ai-audio-book');
const backendService = resolveServiceName(process.argv[3], 'ai-audio-book-api');

let backendUrl;
try {
  backendUrl = getServiceUrl(backendService);
} catch (e) {
  console.error(`Could not find backend service "${backendService}" in region us-central1.`);
  console.error('Deploy the backend first with "npm run deploy-source-backend" (or from the repo root).');
  process.exit(1);
}

const frontendUrl = deployFrontend(rootDir, config, frontendService, backendUrl);
console.log(`\nFrontend deployed: ${frontendUrl}`);

updateBackendCors(backendService, frontendUrl);
