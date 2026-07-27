const { runDeploy } = require('./deploy-helper');

const allowedKeys = [
  '_SECRETS_BUCKET',
  '_VITE_FIREBASE_API_KEY',
  '_VITE_FIREBASE_AUTH_DOMAIN',
  '_VITE_FIREBASE_PROJECT_ID',
  '_VITE_FIREBASE_STORAGE_BUCKET',
  '_VITE_FIREBASE_MESSAGING_SENDER_ID',
  '_VITE_FIREBASE_APP_ID',
  '_VITE_GOOGLE_CLIENT_ID',
  '_GEMINI_API_KEY'
];

runDeploy('cloudbuild.yaml', allowedKeys);
