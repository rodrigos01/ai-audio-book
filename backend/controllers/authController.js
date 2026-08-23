const admin = require('../firebase-config');
const { UnauthorizedError } = require('../utils/errors');

class AuthController {
  async createPairingToken({ userId }) {
    if (!userId) throw new UnauthorizedError('Must be logged in to pair a device');
    const customToken = await admin.auth().createCustomToken(userId);
    return { customToken };
  }
}

module.exports = new AuthController();
