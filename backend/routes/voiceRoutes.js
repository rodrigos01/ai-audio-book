const express = require('express');
const router = express.Router();
const voiceController = require('../controllers/voiceController');
const handleRouteError = require('./errorHandler');

router.get('/', (req, res) => {
  try {
    const voices = voiceController.getVoices({ tierFilter: req.query.tier });
    res.json(voices);
  } catch (err) {
    handleRouteError(res, err);
  }
});

module.exports = router;
