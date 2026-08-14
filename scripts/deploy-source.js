const path = require('path');
const {
  loadConfig,
  getBranchServicePrefix,
  deployBackend,
  deployFrontend,
  updateBackendCors
} = require('./deploy-source-helper');

const rootDir = path.resolve(__dirname, '..');
const config = loadConfig(rootDir);
const prefix = getBranchServicePrefix();
const backendService = `${prefix}ai-audio-book-api`;
const frontendService = `${prefix}ai-audio-book`;

const backendUrl = deployBackend(rootDir, config, backendService);
console.log(`Backend deployed: ${backendUrl}`);

const frontendUrl = deployFrontend(rootDir, config, frontendService, backendUrl);
console.log(`Frontend deployed: ${frontendUrl}`);

updateBackendCors(backendService, frontendUrl);

console.log('\nDeployment complete!');
console.log(`Frontend: ${frontendUrl}`);
console.log(`Backend:  ${backendUrl}`);
