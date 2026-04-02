const admin = require('firebase-admin');

const fs = require('fs');
const path = require('path');

// initialization with service account if available locally
if (!admin.apps.length) {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'ai-audio-book-36e0611138d4.json');
  if (fs.existsSync(keyPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(require(keyPath))
    });
  } else {
    admin.initializeApp();
  }
}

module.exports = admin;
