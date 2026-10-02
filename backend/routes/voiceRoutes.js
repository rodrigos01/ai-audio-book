const express = require('express');
const router = express.Router();
const voiceController = require('../controllers/voiceController');
const titleController = require('../controllers/titleController');
const handleRouteError = require('./errorHandler');

router.get('/', async (req, res) => {
  try {
    const voices = await voiceController.getVoices({
      language: req.query.language,
      gender: req.query.gender,
      accent: req.query.accent
    });
    res.json(voices);
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.get('/:voiceId/preview', async (req, res) => {
  try {
    const audio = await titleController.getLibraryVoicePreview({
      voiceId: req.params.voiceId,
      language: req.query.language
    });
    res.setHeader('Content-Type', 'audio/aac');
    res.setHeader('Content-Length', audio.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(audio);
  } catch (err) {
    handleRouteError(res, err);
  }
});

module.exports = router;
