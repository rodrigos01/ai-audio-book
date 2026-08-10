const fs = require('fs');
const path = require('path');

function debugLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.resolve(__dirname, '../../backend.log'), line + '\n');
  } catch (e) {
    // Ignore file write errors
  }
}

module.exports = { debugLog };
