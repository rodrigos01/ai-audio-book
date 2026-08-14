const path = require('path');
const { loadConfig, getBranchServicePrefix, deployFrontend, getServiceUrl, updateBackendCors } = require('../../scripts/deploy-source-helper');

const rootDir = path.resolve(__dirname, '../..');
const config = loadConfig(rootDir);
const prefix = getBranchServicePrefix();
const backendService = `${prefix}ai-audio-book-api`;
const frontendService = `${prefix}ai-audio-book`;

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
