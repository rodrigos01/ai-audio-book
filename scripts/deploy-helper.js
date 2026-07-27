const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

function runDeploy(configFile, allowedKeys) {
  const frontendEnv = loadEnv(path.join(__dirname, '../frontend/.env'));
  const backendEnv = loadEnv(path.join(__dirname, '../backend/.env'));
  const rootEnv = loadEnv(path.join(__dirname, '../.env'));

  const config = {
    ...frontendEnv,
    ...backendEnv,
    ...rootEnv,
    ...process.env
  };

  const allSubstitutions = {
    _SECRETS_BUCKET: config.SECRETS_BUCKET || config._SECRETS_BUCKET || 'ai-audio-book-secrets',
    _VITE_FIREBASE_API_KEY: config.VITE_FIREBASE_API_KEY || '',
    _VITE_FIREBASE_AUTH_DOMAIN: config.VITE_FIREBASE_AUTH_DOMAIN || '',
    _VITE_FIREBASE_PROJECT_ID: config.VITE_FIREBASE_PROJECT_ID || '',
    _VITE_FIREBASE_STORAGE_BUCKET: config.VITE_FIREBASE_STORAGE_BUCKET || '',
    _VITE_FIREBASE_MESSAGING_SENDER_ID: config.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    _VITE_FIREBASE_APP_ID: config.VITE_FIREBASE_APP_ID || '',
    _VITE_GOOGLE_CLIENT_ID: config.VITE_GOOGLE_CLIENT_ID || '',
    _GEMINI_API_KEY: config.GEMINI_API_KEY || ''
  };

  // Filter substitutions by allowed keys for the specific config file to avoid warning logs
  const filteredSubstitutions = {};
  allowedKeys.forEach(key => {
    if (allSubstitutions[key] !== undefined) {
      filteredSubstitutions[key] = allSubstitutions[key];
    }
  });

  const subString = Object.entries(filteredSubstitutions)
    .map(([key, val]) => `${key}=${val}`)
    .join(',');

  const rootDir = path.resolve(__dirname, '..');
  const args = [
    'builds',
    'submit',
    rootDir,
    '--config',
    path.resolve(rootDir, configFile),
    '--project',
    'ai-audio-book',
    '--substitutions',
    subString
  ];

  console.log(`Starting Cloud Build deployment using config: ${configFile}...`);
  const child = spawn('gcloud', args, { stdio: 'inherit', shell: true });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`Deployment failed with exit code ${code}`);
      process.exit(code);
    }
    console.log('Deployment completed successfully!');
  });
}

module.exports = { runDeploy };
