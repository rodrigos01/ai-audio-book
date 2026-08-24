const express = require('express');
const router = express.Router();
const titleController = require('../controllers/titleController');
const authController = require('../controllers/authController');
const handleRouteError = require('./errorHandler');

router.post('/claim', async (req, res) => {
  try {
    const result = await titleController.claimTitles({
      clientId: req.clientId,
      userId: req.userId
    });
    res.json(result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.post('/pair', async (req, res) => {
  try {
    const result = await authController.createPairingToken({
      userId: req.userId
    });
    res.json(result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

module.exports = router;
