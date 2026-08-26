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

// Structured error log: a top-level `severity` key in a JSON stdout line is
// Cloud Logging's structured-logging convention -- Cloud Run's logging agent
// promotes it automatically, and Cloud Error Reporting auto-ingests ERROR+
// entries with a stack trace, with no extra library or setup.
function logError(context, err, extra = {}) {
  console.error(JSON.stringify({
    severity: 'ERROR',
    message: `[${context}] ${err.message}`,
    context,
    error_code: err.code || extra.code,
    stack: err.stack,
    ...extra,
    timestamp: new Date().toISOString()
  }));
}

module.exports = { debugLog, logError };
