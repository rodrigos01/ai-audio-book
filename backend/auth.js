const admin = require('./firebase-config');

const authMiddleware = async (req, res, next) => {
  let idToken = null;
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    idToken = authHeader.split('Bearer ')[1];
  } else if (req.query.token) {
    idToken = req.query.token;
  }

  if (!idToken) {
    req.user = null;
    req.userId = null;
    return next();
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    req.userId = decodedToken.uid;
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error.message);
    req.user = null;
    req.userId = null;
  }
  next();
};

module.exports = authMiddleware;
