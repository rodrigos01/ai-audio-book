const { runDeploy } = require('../../scripts/deploy-helper');

const allowedKeys = [
  '_SECRETS_BUCKET',
  '_GEMINI_API_KEY'
];

runDeploy('backend/cloudbuild.yaml', allowedKeys);
