const path = require('path');
const {
  loadConfig,
  resolveServiceName,
  deployBackend,
  deployFrontend,
  updateBackendCors
} = require('./deploy-source-helper');

// Usage: npm run deploy-source -- [backend-service-name] [frontend-service-name]
// Defaults to claude-develop-ai-audio-book(-api) in Claude Code cloud sessions,
// or branch-derived names everywhere else -- see resolveServiceName.
const rootDir = path.resolve(__dirname, '..');
const config = loadConfig(rootDir);
const backendService = resolveServiceName(process.argv[2], 'ai-audio-book-api');
const frontendService = resolveServiceName(process.argv[3], 'ai-audio-book');

const backendUrl = deployBackend(rootDir, config, backendService);
console.log(`Backend deployed: ${backendUrl}`);

const frontendUrl = deployFrontend(rootDir, config, frontendService, backendUrl);
console.log(`Frontend deployed: ${frontendUrl}`);

updateBackendCors(backendService, frontendUrl);

console.log('\nDeployment complete!');
console.log(`Frontend: ${frontendUrl}`);
console.log(`Backend:  ${backendUrl}`);
