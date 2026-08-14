const path = require('path');
const { loadConfig, resolveServiceName, deployBackend } = require('../../scripts/deploy-source-helper');

// Usage: npm run deploy-source-backend -- [service-name]
// Defaults to claude-develop-ai-audio-book-api in Claude Code cloud sessions,
// or a branch-derived name everywhere else -- see resolveServiceName.
const rootDir = path.resolve(__dirname, '../..');
const config = loadConfig(rootDir);
const backendService = resolveServiceName(process.argv[2], 'ai-audio-book-api');

const backendUrl = deployBackend(rootDir, config, backendService);
console.log(`\nBackend deployed: ${backendUrl}`);
