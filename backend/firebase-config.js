const admin = require('firebase-admin');

// No service account JSON provided in code, uses GOOGLE_APPLICATION_CREDENTIALS
if (!admin.apps.length) {
  admin.initializeApp();
}

module.exports = admin;
