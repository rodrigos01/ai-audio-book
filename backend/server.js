const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const FirestoreRepository = require('./firestore-repository');
const db = new FirestoreRepository();
const authMiddleware = require('./auth');
const textToSpeech = require('@google-cloud/text-to-speech');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3005;

// Basic health check - must be before any middleware that might hang
app.get('/health', (req, res) => res.status(200).send('OK'));
const STORAGE_BASE_PATH = path.resolve(process.env.STORAGE_BASE_PATH || __dirname);
const audioDir = path.join(STORAGE_BASE_PATH, 'audio_files');
const samplesDir = path.join(STORAGE_BASE_PATH, 'samples');

// Ensure storage directories exist
[audioDir, samplesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function debugLog(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// TTS Client
let ttsClient;
try {
  // Use GOOGLE_APPLICATION_CREDENTIALS if set, otherwise fallback to local key file
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'ai-audio-book-36e0611138d4.json');
  if (fs.existsSync(keyPath)) {
    ttsClient = new textToSpeech.TextToSpeechClient({ keyFilename: keyPath });
    debugLog(`Google Cloud TTS Client initialized with key file: ${keyPath}`);
  } else {
    ttsClient = new textToSpeech.TextToSpeechClient();
    debugLog('Google Cloud TTS Client initialized with Application Default Credentials');
  }
} catch (e) {
  debugLog('Failed to initialize Google Cloud TTS Client: ' + e.message);
}

const allowedOrigins = [
  'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
  'http://localhost:5176', 'http://localhost:5177', 'http://localhost:5178',
  'http://localhost:5179', 'http://localhost:3005', 'http://localhost:3000'
];

// Static assets should be served before CORS and Auth middleware
const frontendDist = path.resolve(__dirname, '../frontend/dist');
debugLog(`Serving frontend from: ${frontendDist}`);

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, {
    setHeaders: (res, path) => {
      if (path.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
      if (path.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    }
  }));
} else {
  debugLog(`Frontend dist not found at: ${frontendDist}`);
}

if (fs.existsSync(samplesDir)) {
  app.use('/samples', express.static(samplesDir));
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'production') {
      callback(null, true);
    } else {
      console.log(`CORS blocked for origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(authMiddleware);

// Assign client_id cookie
app.use((req, res, next) => {
  let clientId = req.cookies.client_id;
  if (!clientId) {
    clientId = uuidv4();
    res.cookie('client_id', clientId, { maxAge: 1000 * 60 * 60 * 24 * 365, httpOnly: true, sameSite: 'lax' });
  }
  req.clientId = clientId;
  next();
});

// Utility to break content into paragraphs or sentences
function breakContentIntoSections(content) {
  const paragraphs = content.split(/\r?\n\s*\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
  const sections = [];
  const MAX_SECTION_LENGTH = 2000;

  for (let p of paragraphs) {
    if (p.length <= MAX_SECTION_LENGTH) {
      sections.push(p);
    } else {
      const sentences = p.split(/(?<=[.!?])\s+/);
      let currentSection = "";
      for (let s of sentences) {
        if ((currentSection + s).length > MAX_SECTION_LENGTH && currentSection.length > 0) {
          sections.push(currentSection.trim());
          currentSection = s;
        } else {
          currentSection += (currentSection ? " " : "") + s;
        }
      }
      if (currentSection) {
        const finalSection = currentSection.trim();
        if (finalSection.length > MAX_SECTION_LENGTH + 1000) {
          for (let i = 0; i < finalSection.length; i += MAX_SECTION_LENGTH) {
            sections.push(finalSection.substring(i, i + MAX_SECTION_LENGTH));
          }
        } else {
          sections.push(finalSection);
        }
      }
    }
  }
  return sections;
}

// Google Docs Parser
function extractTextFromGoogleDoc(doc) {
  let fullText = '';
  if (!doc.body || !doc.body.content) return '';

  doc.body.content.forEach((element) => {
    if (element.paragraph) {
      element.paragraph.elements.forEach((el) => {
        if (el.textRun) {
          fullText += el.textRun.content;
        }
      });
    } else if (element.table) {
      element.table.tableRows.forEach((row) => {
        row.tableCells.forEach((cell) => {
          cell.content.forEach((cellElement) => {
            if (cellElement.paragraph) {
              cellElement.paragraph.elements.forEach((el) => {
                if (el.textRun) {
                  fullText += el.textRun.content;
                }
              });
            }
          });
          fullText += ' ';
        });
        fullText += '\n';
      });
    }
  });
  return fullText;
}

// API Routes
app.post('/api/google-docs/fetch', async (req, res) => {
  const { documentId, googleAccessToken } = req.body;

  if (!documentId || !googleAccessToken) {
    return res.status(400).json({ error: 'documentId and googleAccessToken are required' });
  }

  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: googleAccessToken });

    const docs = google.docs({ version: 'v1', auth });
    const response = await docs.documents.get({ documentId });

    const content = extractTextFromGoogleDoc(response.data);
    res.json({
      title: response.data.title,
      content: content
    });
  } catch (error) {
    console.error('Error fetching Google Doc:', error);
    res.status(500).json({ error: 'Failed to fetch Google Document. Ensure the token is valid and you have access.' });
  }
});

app.get('/api/voices', (req, res) => {
  const VOICES = require('./voices.json');
  const enrichedVoices = VOICES.map(v => ({ 
    ...v, 
    lang: 'en-US', 
    sampleUrl: `/samples/${v.id}.mp3` 
  }));
  res.json(enrichedVoices);
});

// app.get('/api/titles', async (req, res) => {
//   try {
//     const titles = await db.getTitles(req.clientId, req.userId);
//     res.json(titles);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

app.post('/api/titles', async (req, res) => {
  const { name } = req.body;
  const id = uuidv4();
  try {
    await db.createTitle({
      id,
      name,
      client_id: req.clientId,
      user_id: req.userId
    });
    res.json({ id, name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// app.get('/api/titles/:id', async (req, res) => {
//   try {
//     const title = await db.getTitle(req.params.id, req.clientId, req.userId);
//     if (!title) return res.status(404).json({ error: 'Title not found' });
//     res.json(title);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

app.patch('/api/titles/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  try {
    const title = await db.getTitle(id, req.clientId, req.userId);
    if (!title) return res.status(404).json({ error: 'Title not found' });
    await db.updateTitle(id, { name });
    res.json({ id, name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/titles/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const title = await db.getTitle(id, req.clientId, req.userId);
    if (!title) return res.status(404).json({ error: 'Title not found' });
    await db.deleteTitle(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// app.get('/api/titles/:titleId/chapters', async (req, res) => {
//   const { titleId } = req.params;
//   try {
//     const rows = await db.getChapters(titleId);
//     res.json(rows);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

app.post('/api/titles/:id/chapters', async (req, res) => {
  const titleId = req.params.id;
  const { content, voice_id, name } = req.body;

  if (!content) return res.status(400).json({ error: 'Content is required' });

  try {
    const title = await db.getTitle(titleId, req.clientId, req.userId);
    if (!title) return res.status(404).json({ error: 'Title not found' });

    const maxOrder = await db.getMaxChapterOrder(titleId);
    const orderIndex = maxOrder + 1;
    const voiceId = voice_id || 'en-US-Chirp3-HD-Aoede';
    const chapterId = uuidv4();

    await db.createChapter({
      id: chapterId,
      title_id: titleId,
      order_index: orderIndex,
      content,
      voice_id: voiceId,
      name: name || null
    });

    const sections = breakContentIntoSections(content);
    const sectionItems = sections.map((text, i) => ({
      id: uuidv4(),
      chapter_id: chapterId,
      section_index: i,
      content: text,
      status: 'pending',
      audio_file_path: null
    }));
    await db.insertSections(sectionItems);
    res.json({ id: chapterId, title_id: titleId, order_index: orderIndex, name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// app.get('/api/chapters/:id', async (req, res) => {
//   try {
//     const chapter = await db.getChapterWithTitle(req.params.id, req.clientId, req.userId);
//     if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
//     
//     // Fetch sections to calculate estimated duration
//     const sections = await db.getSections(req.params.id);
//     
//     let totalEstimatedDuration = 0;
//     const sectionsWithEstimates = sections.map((s, idx) => {
//       const sectionDuration = s.content.length / 8.1 + 0.5;
//       const startTime = totalEstimatedDuration;
//       totalEstimatedDuration += sectionDuration;
//       return {
//         id: s.id,
//         section_index: idx,
//         estimated_duration: sectionDuration,
//         estimated_start_time: startTime
//       };
//     });
// 
//     res.json({
//       ...chapter,
//       estimated_duration_seconds: totalEstimatedDuration,
//       sections: sectionsWithEstimates
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

app.delete('/api/chapters/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.deleteChapter(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chapters/:chapterId/stream', async (req, res) => {
  const { chapterId } = req.params;
  debugLog(`Stream Request for ${chapterId}: token_present=${!!req.query.token}, user_id=${req.userId}`);

  let isClosed = false;
  req.on('close', () => { isClosed = true; });

  try {
    const chapter = await db.getChapter(chapterId);
    if (!chapter) return res.status(404).end();
    const title = await db.getTitle(chapter.title_id, req.clientId, req.userId);
    if (!title) {
      debugLog(`Stream Forbidden for ${chapterId}: clientId=${req.clientId}, userId=${req.userId}`);
      return res.status(403).end();
    }

    const startIndex = parseInt(req.query.offset || 0);
    debugLog(`Streaming ${chapterId} starting from offset ${startIndex}`);
    const sections = await db.getSections(chapterId, startIndex);
    debugLog(`Found ${sections.length} sections for offset ${startIndex}`);
    if (sections.length === 0) {
      debugLog(`No sections found for ${chapterId} with offset ${startIndex}. Chapter likely has fewer sections.`);
      return res.status(404).json({ error: 'Section offset out of bounds' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');

    res.setHeader('Transfer-Encoding', 'chunked');

    const silentMp3 = Buffer.from('//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAAA', 'base64');
    const pauseBuffer = Buffer.concat(Array(15).fill(silentMp3));

    for (const section of sections) {
      if (isClosed) break;
      const localPath = path.join(audioDir, `${section.id}.mp3`);

      let audioBuffer;
      let alreadyExists = false;

      if (fs.existsSync(localPath)) {
        audioBuffer = fs.readFileSync(localPath);
        alreadyExists = true;
      }

      if (alreadyExists) {
        res.write(audioBuffer);
      } else {
        const escapeXml = (unsafe) => {
          return unsafe.replace(/[<>&'"]/g, (c) => {
            switch (c) {
              case '<': return '&lt;';
              case '>': return '&gt;';
              case '&': return '&amp;';
              case '\'': return '&apos;';
              case '"': return '&quot;';
              default: return c;
            }
          });
        };
        const ssmlContent = `<speak>${escapeXml(section.content)}<break time="500ms"/></speak>`;
        const request = {
          input: { ssml: ssmlContent },
          voice: { languageCode: 'en-US', name: chapter.voice_id || 'en-US-Chirp3-HD-Aoede' },
          audioConfig: { audioEncoding: 'MP3' },
        };
        try {
          debugLog(`Generating audio for ${section.id}`);
          const [response] = await ttsClient.synthesizeSpeech(request);
          audioBuffer = response.audioContent;

          fs.writeFileSync(localPath, audioBuffer);
          await db.updateSection(section.id, { status: 'generated', audio_file_path: localPath });
          res.write(audioBuffer);
        } catch (e) {
          debugLog(`Error generating audio: ${e.message}`);
        }
      }
    }
    res.end();
  } catch (error) {
    res.end();
  }
});

app.post('/api/auth/claim', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'Must be logged in to claim books' });
  try {
    const count = await db.linkAnonymousBooks(req.clientId, req.userId);
    res.json({ success: true, claimed_count: count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend samples and static app
if (fs.existsSync(samplesDir)) {
  app.use('/samples', express.static(samplesDir));
}

// app.use(express.static(frontendDist));

// Fallback to index.html for SPA
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API not found' });
  const indexFile = path.join(frontendDist, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    // In local dev, we might not have distilled the frontend into the backend folder
    res.status(404).send('Frontend not built. Please run npm run build in frontend folder.');
  }
});

app.listen(PORT, () => {
  debugLog(`Server listening on port ${PORT}`);
});
