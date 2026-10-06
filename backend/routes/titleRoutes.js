const express = require('express');
const router = express.Router();
const titleController = require('../controllers/titleController');
const authMiddleware = require('../auth');
const handleRouteError = require('./errorHandler');

router.post('/', async (req, res) => {
  try {
    const result = await titleController.createTitle({
      name: req.body.name,
      ai_casting_enabled: req.body.ai_casting_enabled,
      narrator_voice: req.body.narrator_voice,
      language: req.body.language,
      clientId: req.clientId,
      userId: req.userId
    });
    res.json(result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await titleController.updateTitle({
      id: req.params.id,
      name: req.body.name,
      casting_map: req.body.casting_map,
      narrator_voice: req.body.narrator_voice,
      language: req.body.language,
      voices: req.body.voices,
      clientId: req.clientId,
      userId: req.userId
    });
    res.json(result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await titleController.deleteTitle({
      id: req.params.id,
      clientId: req.clientId,
      userId: req.userId
    });
    res.json(result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.post('/:id/chapters', authMiddleware, async (req, res) => {
  try {
    const result = await titleController.addChapter({
      titleId: req.params.id,
      content: req.body.content,
      voice_id: req.body.voice_id,
      name: req.body.name,
      google_doc_id: req.body.google_doc_id,
      google_access_token: req.body.google_access_token,
      skip_script_generation: req.body.skip_script_generation,
      clientId: req.clientId,
      userId: req.userId
    });
    res.json(result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

// Sample of a character's current voice (synthesized once, then cached). Plain
// GET so an <audio> element can use it with ?token= / ?client_id= like HLS.
router.get('/:id/voices/:name/preview', async (req, res) => {
  try {
    const audio = await titleController.getVoicePreview({
      id: req.params.id,
      name: req.params.name,
      clientId: req.clientId,
      userId: req.userId
    });
    res.setHeader('Content-Type', 'audio/aac');
    res.setHeader('Content-Length', audio.length);
    res.send(audio);
  } catch (err) {
    handleRouteError(res, err);
  }
});

module.exports = router;
