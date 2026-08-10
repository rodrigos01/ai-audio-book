const express = require('express');
const router = express.Router();
const chapterController = require('../controllers/chapterController');
const authMiddleware = require('../auth');
const handleRouteError = require('./errorHandler');

router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await chapterController.updateChapter({
      id: req.params.id,
      name: req.body.name,
      content: req.body.content,
      is_ssml: req.body.is_ssml,
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
    const result = await chapterController.deleteChapter({ id: req.params.id });
    res.json(result);
  } catch (err) {
    handleRouteError(res, err);
  }
});

router.post('/:chapterId/prepare', authMiddleware, async (req, res) => {
  let isClosed = false;
  req.on('close', () => { isClosed = true; });

  try {
    const result = await chapterController.prepareChapter({
      chapterId: req.params.chapterId,
      clientId: req.clientId,
      userId: req.userId,
      isClosedCheck: () => isClosed
    });
    if (!isClosed) res.json(result);
  } catch (err) {
    if (!isClosed) handleRouteError(res, err);
  }
});

router.get('/:chapterId/stream', async (req, res) => {
  let isClosed = false;
  req.on('close', () => { isClosed = true; });

  try {
    const offset = parseInt(req.query.offset || 0);

    await chapterController.streamChapterAudio({
      chapterId: req.params.chapterId,
      offset,
      onReady: () => {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Transfer-Encoding', 'chunked');
      },
      onAudioChunk: (chunk) => {
        if (!isClosed) res.write(chunk);
      },
      isClosedCheck: () => isClosed
    });

    if (!isClosed) res.end();
  } catch (err) {
    if (res.headersSent) {
      res.destroy();
    } else {
      handleRouteError(res, err);
    }
  }
});

module.exports = router;
