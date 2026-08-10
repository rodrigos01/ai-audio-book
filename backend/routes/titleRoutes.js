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
      tts_tier: req.body.tts_tier,
      narrator_voice: req.body.narrator_voice,
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
      clientId: req.clientId,
      userId: req.userId
    });
    res.json(result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

module.exports = router;
