const { runDeploy } = require('../../scripts/deploy-helper');

const allowedKeys = [
  '_VITE_FIREBASE_API_KEY',
  '_VITE_FIREBASE_AUTH_DOMAIN',
  '_VITE_FIREBASE_PROJECT_ID',
  '_VITE_FIREBASE_STORAGE_BUCKET',
  '_VITE_FIREBASE_MESSAGING_SENDER_ID',
  '_VITE_FIREBASE_APP_ID',
  '_VITE_GOOGLE_CLIENT_ID'
];

runDeploy('frontend/cloudbuild.yaml', allowedKeys);
