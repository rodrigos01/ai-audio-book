const path = require('path');
const { loadConfig, getBranchServicePrefix, deployBackend } = require('../../scripts/deploy-source-helper');

const rootDir = path.resolve(__dirname, '../..');
const config = loadConfig(rootDir);
const prefix = getBranchServicePrefix();
const backendService = `${prefix}ai-audio-book-api`;

const backendUrl = deployBackend(rootDir, config, backendService);
console.log(`\nBackend deployed: ${backendUrl}`);
