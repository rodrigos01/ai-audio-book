const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { promiseDb: db } = require('./database');
const textToSpeech = require('@google-cloud/text-to-speech');

const app = express();
const PORT = process.env.PORT || 3005;
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

// API Routes
app.get('/api/voices', (req, res) => {
  const VOICES = [
    { id: 'en-US-Chirp3-HD-Aoede', name: 'Aria (Female)', lang: 'en-US', gender: 'Female', quality: 'HD' },
    { id: 'en-US-Chirp3-HD-Kore', name: 'Kore (Female)', lang: 'en-US', gender: 'Female', quality: 'HD' },
    { id: 'en-US-Chirp3-HD-Leda', name: 'Leda (Female)', lang: 'en-US', gender: 'Female', quality: 'HD' },
    { id: 'en-US-Chirp3-HD-Charon', name: 'Charon (Male)', lang: 'en-US', gender: 'Male', quality: 'HD' },
    { id: 'en-US-Chirp3-HD-Fenrir', name: 'Finn (Male)', lang: 'en-US', gender: 'Male', quality: 'HD' },
    { id: 'en-US-Chirp3-HD-Orus', name: 'Oscar (Male)', lang: 'en-US', gender: 'Male', quality: 'HD' }
  ].map(v => ({ ...v, sampleUrl: `/samples/${v.id}.mp3` }));
  res.json(VOICES);
});

app.get('/api/titles', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM titles WHERE client_id = ? ORDER BY created_at DESC', [req.clientId]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/titles', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  try {
    await db.run('INSERT INTO titles (id, client_id, name) VALUES (?, ?, ?)', [id, req.clientId, name]);
    res.json({ id, name, client_id: req.clientId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/titles/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  try {
    const title = await db.get('SELECT * FROM titles WHERE id = ? AND client_id = ?', [id, req.clientId]);
    if (!title) return res.status(404).json({ error: 'Title not found' });
    await db.run('UPDATE titles SET name = ? WHERE id = ?', [name, id]);
    res.json({ id, name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/titles/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const title = await db.get('SELECT * FROM titles WHERE id = ? AND client_id = ?', [id, req.clientId]);
    if (!title) return res.status(404).json({ error: 'Title not found' });
    await db.run('DELETE FROM titles WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/titles/:titleId/chapters', async (req, res) => {
  const { titleId } = req.params;
  try {
    const rows = await db.all('SELECT id, title_id, name, order_index, created_at FROM chapters WHERE title_id = ? ORDER BY order_index ASC', [titleId]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/titles/:titleId/chapters', async (req, res) => {
  const { titleId } = req.params;
  const { content, voice_id, name } = req.body;
  if (!content) return res.status(400).json({ error: 'Content is required' });
  try {
    const title = await db.get('SELECT * FROM titles WHERE id = ? AND client_id = ?', [titleId, req.clientId]);
    if (!title) return res.status(404).json({ error: 'Title not found' });
    const lastChapter = await db.get('SELECT MAX(order_index) as max_order FROM chapters WHERE title_id = ?', [titleId]);
    const orderIndex = (lastChapter && lastChapter.max_order !== null) ? lastChapter.max_order + 1 : 1;
    const voiceId = voice_id || 'en-US-Chirp3-HD-Aoede';
    const chapterId = uuidv4();
    await db.run('INSERT INTO chapters (id, title_id, order_index, content, voice_id, name) VALUES (?, ?, ?, ?, ?, ?)', [chapterId, titleId, orderIndex, content, voiceId, name || null]);
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

app.get('/api/chapters/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const chapter = await db.get('SELECT c.*, t.name as title_name FROM chapters c JOIN titles t ON c.title_id = t.id WHERE c.id = ? AND t.client_id = ?', [id, req.clientId]);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    
    // Fetch sections to calculate estimated duration
    const sections = await db.all('SELECT id, content FROM chapter_sections WHERE chapter_id = ? ORDER BY section_index ASC', [id]);
    
    let totalEstimatedDuration = 0;
    const sectionsWithEstimates = sections.map((s, idx) => {
      const sectionDuration = s.content.length / 8.1 + 0.5; // Adjusted to 8.1 chars/sec for Chirp3 HD
      const startTime = totalEstimatedDuration;
      totalEstimatedDuration += sectionDuration;
      return {
        id: s.id,
        section_index: idx,
        estimated_duration: sectionDuration,
        estimated_start_time: startTime
      };
    });

    res.json({
      ...chapter,
      estimated_duration_seconds: totalEstimatedDuration,
      sections: sectionsWithEstimates
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/chapters/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM chapters WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chapters/:chapterId/stream', async (req, res) => {
  const { chapterId } = req.params;
  try {
    const chapter = await db.get('SELECT * FROM chapters WHERE id = ?', [chapterId]);
    if (!chapter) return res.status(404).end();
    const title = await db.get('SELECT client_id FROM titles WHERE id = ?', [chapter.title_id]);
    if (!title || title.client_id !== req.clientId) return res.status(403).end();
    
    
    const startIndex = parseInt(req.query.offset || 0);
    debugLog(`Streaming ${chapterId} starting from offset ${startIndex}`);
    const sections = await db.all('SELECT * FROM chapter_sections WHERE chapter_id = ? AND section_index >= ? ORDER BY section_index ASC', [chapterId, startIndex]);
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
          await db.run('UPDATE chapter_sections SET status = ?, audio_file_path = ? WHERE id = ?', ['generated', localPath, section.id]);
          res.write(audioBuffer);
        } catch (e) {
          debugLog(`Error generating audio: ${e.message}`);
        }
      }
    }
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.end();
  }
});

// Serve frontend samples and static app
if (fs.existsSync(samplesDir)) {
    app.use('/samples', express.static(samplesDir));
}

const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));

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
