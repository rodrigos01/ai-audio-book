require('dotenv').config();
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
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.resolve(__dirname, '../backend.log'), line + '\n');
  } catch (e) {
    // Ignore file write errors
  }
}

// TTS Client
let ttsClient;
try {
  // Use GOOGLE_APPLICATION_CREDENTIALS if set, otherwise fallback to local key file
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'ai-audio-book-36e0611138d4.json');
  if (fs.existsSync(keyPath)) {
    ttsClient = new textToSpeech.TextToSpeechClient({ keyFilename: keyPath, apiEndpoint: 'us-central1-texttospeech.googleapis.com' });
    debugLog(`Google Cloud TTS Client initialized with key file: ${keyPath}`);
  } else {
    ttsClient = new textToSpeech.TextToSpeechClient({ apiEndpoint: 'us-central1-texttospeech.googleapis.com' });
    debugLog('Google Cloud TTS Client initialized with Application Default Credentials');
  }
} catch (e) {
  debugLog('Failed to initialize Google Cloud TTS Client: ' + e.message);
}

const allowedOrigins = [
  'http://localhost:*', 'https://ai-audio-book-883622140264.us-central1.run.app'
];

if (process.env.ALLOWED_ORIGINS) {
  const envOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  allowedOrigins.push(...envOrigins);
}

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
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }

    // Dynamically allow local development, Firebase, and Cloud Run service subdomains
    const isLocalhost = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
    const isFirebase = origin.endsWith('.web.app') || origin.endsWith('.firebaseapp.com');
    // Covers both the legacy hash-based URLs (*.a.run.app) and the newer
    // default URL format (SERVICE-PROJECTNUMBER.REGION.run.app).
    const isCloudRun = origin.endsWith('.run.app');

    if (isLocalhost || isFirebase || isCloudRun) {
      return callback(null, true);
    }

    if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
      return callback(null, true);
    }
    console.log(`CORS blocked for origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(authMiddleware);

// Assign client_id cookie or read from custom header / query param
app.use((req, res, next) => {
  let clientId = req.headers['x-client-id'] || req.cookies.client_id || req.query.client_id;
  if (!clientId) {
    clientId = uuidv4();
  }
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('client_id', clientId, {
    maxAge: 1000 * 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd
  });

  res.setHeader('Access-Control-Expose-Headers', 'x-client-id');
  res.setHeader('x-client-id', clientId);

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

async function deleteChapterSections(chapterId) {
  try {
    const sections = await db.getSections(chapterId);

    const admin = require('./firebase-config');
    const batch = admin.firestore().batch();

    // Bump so clients with an offline-downloaded copy of this chapter's audio
    // know it's stale (the audio no longer matches the chapter's content/voice).
    batch.update(admin.firestore().collection('chapters').doc(chapterId), {
      audio_version: admin.firestore.FieldValue.increment(1)
    });

    if (sections.length === 0) {
      await batch.commit();
      return;
    }

    sections.forEach(s => {
      // Delete from DB
      batch.delete(admin.firestore().collection('chapter_sections').doc(s.id));

      // Delete from Disk
      const audioPath = path.join(audioDir, `${s.id}.mp3`);
      if (fs.existsSync(audioPath)) {
        try { fs.unlinkSync(audioPath); } catch (e) { debugLog(`Error deleting file: ${e.message}`); }
      }
    });

    await batch.commit();
    debugLog(`Cleaned up ${sections.length} sections for chapter ${chapterId}`);
  } catch (e) {
    debugLog(`Failed during section cleanup: ${e.message}`);
  }
}

function splitSSMLIntoSections(ssml) {
  if (!ssml) return [];
  // Strip markdown code fences (e.g. ```xml ... ``` or ```)
  let clean = ssml.replace(/```[a-z]*\s*/gi, '').replace(/```/gi, '').trim();
  // Strip outer/inner <speak> and </speak> tags
  clean = clean.replace(/<\/?speak>/gi, '').trim();

  // Split by </p>
  const parts = clean.split(/<\/p>/i);
  const validSections = [];

  for (let p of parts) {
    let trimmed = p.trim();
    if (!trimmed) continue;
    if (!trimmed.toLowerCase().startsWith('<p>')) {
      trimmed = `<p>${trimmed}`;
    }
    if (!trimmed.toLowerCase().endsWith('</p>')) {
      trimmed = `${trimmed}</p>`;
    }

    // Filter out paragraphs that contain no speakable text (only XML tags or whitespace)
    const speakableText = trimmed.replace(/<[^>]*>/g, '').trim();
    if (speakableText.length > 0) {
      validSections.push(`<speak>${trimmed}</speak>`);
    }
  }

  return validSections;
}

// Groups multiple dialogue turns into multi-speaker section blocks for Gemini-TTS.
// Target ~800 bytes max per section to keep synthesis under GCP's 58s gateway deadline.
function splitMultiSpeakerIntoSections(scriptText, maxBytes = 800) {
  if (!scriptText) return [];
  let clean = scriptText.replace(/```[a-z]*\s*/gi, '').replace(/```/gi, '').trim();
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const sections = [];
  let currentGroup = [];
  let currentLength = 0;

  for (const line of lines) {
    const lineLen = Buffer.byteLength(line, 'utf8');
    if (currentLength + lineLen + 1 > maxBytes && currentGroup.length > 0) {
      sections.push(currentGroup.join('\n'));
      currentGroup = [line];
      currentLength = lineLen;
    } else {
      currentGroup.push(line);
      currentLength += lineLen + 1;
    }
  }

  if (currentGroup.length > 0) {
    sections.push(currentGroup.join('\n'));
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
    res.status(500).json({ error: 'Failed to fetch Google Document. Ensure the token is valid and you have access.' });
  }
});

const aiCasting = require('./ai-casting');

app.post('/api/chapters/:chapterId/cast', authMiddleware, async (req, res) => {
  const { chapterId } = req.params;
  try {
    const chapter = await db.getChapter(chapterId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    const title = await db.getTitle(chapter.title_id, req.clientId, req.userId);
    if (!title) return res.status(403).json({ error: 'Forbidden' });

    const VOICES = require('./voices.json');
    const existingCast = title.casting_map || {};
    const existingNarrator = title.narrator_voice || null;
    const tier = title.tts_tier || 'basic';

    debugLog(`AI Casting (${tier}): Analyzing chapter ${chapterId} for ${title.name}`);
    const result = await aiCasting.analyzeChapter(chapter.content, existingCast, VOICES, existingNarrator, tier);

    // Update Title's casting map and record the narrator if it's the first time
    const titleUpdate = { casting_map: result.updated_cast };
    if (!title.narrator_voice) {
      titleUpdate.narrator_voice = result.narrator_voice;
    }
    await db.updateTitle(title.id, titleUpdate);

    const isSSML = tier === 'basic';

    // Update Chapter with SSML content, performance prompt, and flag
    await db.updateChapter(chapterId, {
      content: result.ssml,
      is_ssml: isSSML,
      voice_id: result.narrator_voice,
      performance_prompt: result.performance_prompt || null,
    });

    // Also delete any existing sections because the content has changed
    await deleteChapterSections(chapterId);

    // Create new sections
    const parsedSections = isSSML
      ? splitSSMLIntoSections(result.ssml)
      : splitMultiSpeakerIntoSections(result.ssml);
    const sectionData = parsedSections.map((content, index) => ({
      id: uuidv4(),
      chapter_id: chapterId,
      content,
      section_index: index,
      status: 'pending'
    }));
    await db.insertSections(sectionData);

    res.json({
      success: true,
      casting_map: result.updated_cast,
      ssml: result.ssml,
      sections_count: sectionData.length
    });
  } catch (error) {
    debugLog(`AI Casting Error: ${error.message}\n${error.stack}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/voices', (req, res) => {
  const VOICES = require('./voices.json');
  const tierFilter = req.query.tier;
  let filtered = VOICES;
  if (tierFilter) {
    filtered = VOICES.filter(v => v.tier === tierFilter || (!v.tier && tierFilter === 'basic'));
  }
  const enrichedVoices = filtered.map(v => ({
    ...v,
    lang: 'en-US',
    sampleUrl: `/samples/${v.id}.mp3`
  }));
  res.json(enrichedVoices);
});

app.post('/api/titles', async (req, res) => {
  const { name, ai_casting_enabled, tts_tier, narrator_voice } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const id = uuidv4();
    const tier = tts_tier === 'pro' ? 'pro' : 'basic';
    await db.createTitle({
      id,
      name,
      ai_casting_enabled: !!ai_casting_enabled,
      tts_tier: tier,
      narrator_voice: narrator_voice || null,
      casting_map: {},
      client_id: req.clientId,
      user_id: req.userId
    });
    res.json({ id, name, ai_casting_enabled: !!ai_casting_enabled, tts_tier: tier, narrator_voice: narrator_voice || null });
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

app.patch('/api/titles/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, casting_map, narrator_voice } = req.body;
  try {
    const title = await db.getTitle(id, req.clientId, req.userId);
    if (!title) return res.status(404).json({ error: 'Title not found' });

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (casting_map !== undefined) updateData.casting_map = casting_map;
    if (narrator_voice !== undefined) updateData.narrator_voice = narrator_voice;

    await db.updateTitle(id, updateData);

    // If casting_map changed, propagate changes to all chapters
    if (casting_map !== undefined) {
      const oldMap = title.casting_map || {};
      const newMap = casting_map;

      const changedCharacters = Object.keys(newMap).filter(char => oldMap[char] !== newMap[char]);

      if (changedCharacters.length > 0) {
        debugLog(`Voice change detected for characters: ${changedCharacters.join(', ')}`);
        const chapters = await db.getChapters(id);
        for (const ch of chapters) {
          if (ch.is_ssml) {
            let updated = false;
            let currentSSML = ch.content;

            changedCharacters.forEach(char => {
              const oldVoice = oldMap[char];
              const newVoice = newMap[char];
              // Replace all occurrences of the old voice ID with the new one in the <voice> tag
              if (oldVoice && currentSSML.includes(oldVoice)) {
                currentSSML = currentSSML.replaceAll(oldVoice, newVoice);
                updated = true;
              }
            });

            if (updated) {
              debugLog(`Propagating voice change to chapter ${ch.id}`);
              await db.updateChapter(ch.id, { content: currentSSML });
              await deleteChapterSections(ch.id);

              // Regenerate sections
              const newSections = splitSSMLIntoSections(currentSSML);
              const sectionData = newSections.map((text, i) => ({
                id: uuidv4(),
                chapter_id: ch.id,
                section_index: i,
                content: text,
                status: 'pending'
              }));
              await db.insertSections(sectionData);
            }
          }
        }
      }
    }

    res.json({ success: true });
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

app.post('/api/titles/:id/chapters', authMiddleware, async (req, res) => {
  const titleId = req.params.id;
  let { content, voice_id, name } = req.body;

  if (!content) return res.status(400).json({ error: 'Content is required' });

  try {
    const title = await db.getTitle(titleId, req.clientId, req.userId);
    if (!title) return res.status(404).json({ error: 'Title not found' });

    const maxOrder = await db.getMaxChapterOrder(titleId);
    const orderIndex = maxOrder + 1;
    let voiceId = voice_id || 'en-US-Chirp3-HD-Aoede';
    let isSSML = false;

    let performancePrompt = null;

    if (title.ai_casting_enabled) {
      try {
        const tier = title.tts_tier || 'basic';
        debugLog(`AI Casting (${tier}): Auto-casting new chapter for ${title.name}`);
        const VOICES = require('./voices.json');
        const existingCast = title.casting_map || {};
        const existingNarrator = title.narrator_voice || null;

        const result = await aiCasting.analyzeChapter(content, existingCast, VOICES, existingNarrator, tier);

        // Update Title mapping
        const titleUpdate = { casting_map: result.updated_cast };
        if (!title.narrator_voice) titleUpdate.narrator_voice = result.narrator_voice;
        await db.updateTitle(titleId, titleUpdate);

        content = result.ssml;
        voiceId = result.narrator_voice;
        isSSML = tier === 'basic';
        performancePrompt = result.performance_prompt || null;
      } catch (castError) {
        debugLog(`Auto-casting failed, falling back to standard: ${castError.message}`);
      }
    }

    const chapterId = uuidv4();
    await db.createChapter({
      id: chapterId,
      title_id: titleId,
      order_index: orderIndex,
      content,
      voice_id: voiceId,
      is_ssml: isSSML,
      performance_prompt: performancePrompt,
      name: name || null
    });

    const sections = isSSML
      ? splitSSMLIntoSections(content)
      : (title.tts_tier === 'pro' ? splitMultiSpeakerIntoSections(content) : breakContentIntoSections(content));
    const sectionItems = sections.map((text, i) => ({
      id: uuidv4(),
      chapter_id: chapterId,
      section_index: i,
      content: text,
      status: 'pending',
      audio_url: null
    }));
    await db.insertSections(sectionItems);
    res.json({ id: chapterId, title_id: titleId, order_index: orderIndex, name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/chapters/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, content, is_ssml } = req.body;
  try {
    const chapter = await db.getChapterWithTitle(id, req.clientId, req.userId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found or access denied' });

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (is_ssml !== undefined) updateData.is_ssml = is_ssml;
    if (content !== undefined) updateData.content = content;

    await db.updateChapter(id, updateData);

    // If content changed, we need to re-generate sections
    if (content !== undefined) {
      await deleteChapterSections(id);

      const newSections = (is_ssml || chapter.is_ssml)
        ? splitSSMLIntoSections(content)
        : breakContentIntoSections(content);

      const sectionData = newSections.map((text, i) => ({
        id: uuidv4(),
        chapter_id: id,
        section_index: i,
        content: text,
        status: 'pending'
      }));
      await db.insertSections(sectionData);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/chapters/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.deleteChapter(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function escapeXml(unsafe) {
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
}

function sanitizeSSML(rawContent, isSSML) {
  if (!rawContent) return '<speak></speak>';
  if (!isSSML) {
    return `<speak>${escapeXml(rawContent)}<break time="500ms"/></speak>`;
  }

  // 1. Strip markdown code fences (```xml ... ``` or ```)
  let clean = rawContent.replace(/```[a-z]*\s*/gi, '').replace(/```/gi, '').trim();

  // 2. Strip ALL existing <speak> and </speak> tags (including nested/duplicated ones)
  clean = clean.replace(/<\/?speak\b[^>]*>/gi, '').trim();

  // 3. Wrap in a single, clean <speak> container
  return `<speak>${clean}</speak>`;
}

function getGcpVoiceName(voiceId) {
  if (!voiceId) return 'en-US-Journey-F';
  if (voiceId.startsWith('en-US-')) return voiceId;
  const geminiMap = {
    'Aoede': 'en-US-Journey-F',
    'Puck': 'en-US-Journey-D',
    'Kore': 'en-US-Journey-O',
    'Charon': 'en-US-Journey-M',
    'Fenrir': 'en-US-Casual-K',
    'Leda': 'en-US-Studio-O',
    'Orpheus': 'en-US-Studio-Q',
    'Callisto': 'en-US-News-K'
  };
  return geminiMap[voiceId] || 'en-US-Journey-F';
}

function toGeminiVoiceId(voiceId) {
  if (!voiceId) return 'Aoede';
  const supportedGeminiVoices = ['Aoede', 'Puck', 'Kore', 'Charon', 'Fenrir', 'Leda'];
  if (supportedGeminiVoices.includes(voiceId)) return voiceId;

  const fallbackMap = {
    'Orpheus': 'Charon',
    'Callisto': 'Leda',
    'Achernar': 'Leda',
    'Autonoe': 'Kore',
    'Callirrhoe': 'Aoede',
    'Despina': 'Leda',
    'Erinome': 'Kore',
    'Gacrux': 'Aoede',
    'Laomedeia': 'Leda',
    'Pulcherrima': 'Leda',
    'Sulafat': 'Leda',
    'Vindemiatrix': 'Kore',
    'Zephyr': 'Kore',
    'Orus': 'Charon',
    'Achird': 'Puck',
    'Algenib': 'Fenrir',
    'Algieba': 'Charon',
    'Alnilam': 'Fenrir',
    'Enceladus': 'Charon',
    'Iapetus': 'Charon',
    'Rasalgethi': 'Charon',
    'Sadachbia': 'Puck',
    'Sadaltager': 'Charon',
    'Schedar': 'Charon',
    'Umbriel': 'Charon'
  };

  for (const [key, val] of Object.entries(fallbackMap)) {
    if (voiceId.includes(key)) return val;
  }

  for (const gv of supportedGeminiVoices) {
    if (voiceId.endsWith(gv) || voiceId.toLowerCase().includes(gv.toLowerCase())) {
      return gv;
    }
  }

  return 'Aoede';
}

function extractSpeakerConfigsFromText(text, castingMap, narratorVoice) {
  const supportedGeminiVoices = ['Aoede', 'Puck', 'Kore', 'Charon', 'Fenrir', 'Leda'];
  const speakerConfigs = [];
  const addedAliases = new Set();
  const usedVoiceIds = new Set();

  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^([a-zA-Z0-9]+):/);
    if (match) {
      const alias = match[1];
      if (!addedAliases.has(alias)) {
        let voiceId;
        if (castingMap && castingMap[alias]) {
          voiceId = toGeminiVoiceId(castingMap[alias]);
        } else {
          const foundKey = Object.keys(castingMap || {}).find(k => k.toLowerCase() === alias.toLowerCase());
          if (foundKey) {
            voiceId = toGeminiVoiceId(castingMap[foundKey]);
          } else {
            voiceId = toGeminiVoiceId(alias);
          }
        }

        // Ensure each alias gets a distinct speakerId from supported list
        if (usedVoiceIds.has(voiceId)) {
          const unused = supportedGeminiVoices.find(v => !usedVoiceIds.has(v));
          if (unused) voiceId = unused;
        }

        speakerConfigs.push({ speakerAlias: alias, speakerId: voiceId });
        addedAliases.add(alias);
        usedVoiceIds.add(voiceId);
      }
    }
  }

  // Fallback: If text had no lines with "Alias:", add Narrator with narratorVoice
  if (speakerConfigs.length === 0) {
    const defaultNarrator = toGeminiVoiceId(narratorVoice);
    speakerConfigs.push({ speakerAlias: 'Narrator', speakerId: defaultNarrator });
  }

  return speakerConfigs;
}

// Synthesizes a section's audio via TTS and caches it to disk + Firestore.
// Returns the audio buffer on success, or null if synthesis failed.
async function synthesizeAndCacheSection(title, chapter, section, localPath) {
  const isProTier = title && title.tts_tier === 'pro';
  const isSSML = !isProTier && chapter.is_ssml && (section.content || '').trim().startsWith('<speak>');
  let request;

  if (isSSML) {
    const ssmlContent = sanitizeSSML(section.content, true);
    const speakableText = (ssmlContent || '').replace(/<[^>]*>/g, '').trim();
    if (speakableText.length === 0) {
      debugLog(`Section ${section.id} contains no speakable text. Caching silent fallback audio.`);
      const silentMp3 = Buffer.from('//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAAA', 'base64');
      fs.writeFileSync(localPath, silentMp3);
      await db.updateSection(section.id, { status: 'generated', audio_file_path: localPath });
      return silentMp3;
    }

    const rawVoice = chapter.voice_id || 'en-US-Chirp3-HD-Aoede';
    const voiceName = getGcpVoiceName(rawVoice);
    let languageCode = 'en-US';
    if (voiceName.includes('-')) {
      const parts = voiceName.split('-');
      if (parts.length >= 2) languageCode = `${parts[0]}-${parts[1]}`;
    }

    request = {
      input: { ssml: ssmlContent },
      voice: { languageCode, name: voiceName },
      audioConfig: { audioEncoding: 'MP3' },
    };
  } else if (isProTier) {
    // Gemini-TTS Multi-Speaker synthesis specification
    const textContent = (section.content || '').replace(/<[^>]*>/g, '').trim();
    if (textContent.length === 0) {
      debugLog(`Section ${section.id} contains no text. Caching silent fallback audio.`);
      const silentMp3 = Buffer.from('//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAAA', 'base64');
      fs.writeFileSync(localPath, silentMp3);
      await db.updateSection(section.id, { status: 'generated', audio_file_path: localPath });
      return silentMp3;
    }

    const castingMap = (title && title.casting_map) || {};
    const narratorVoice = (title && title.narrator_voice) || chapter.voice_id || 'Aoede';
    const speakerConfigs = extractSpeakerConfigsFromText(textContent, castingMap, narratorVoice);
    const performancePrompt = (chapter && chapter.performance_prompt)
      || "Synthesize the text as a multi-speaker dramatic audiobook performance with distinct character voices and natural emotional expressions.";

    request = {
      input: {
        prompt: performancePrompt,
        text: textContent
      },
      voice: {
        languageCode: 'en-US',
        modelName: 'gemini-3.1-flash-tts-preview',
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: speakerConfigs
        }
      },
      audioConfig: {
        audioEncoding: 'MP3'
      }
    };
  } else {
    // Single speaker plain text fallback
    const textContent = (section.content || '').replace(/<[^>]*>/g, '').trim();
    if (textContent.length === 0) {
      debugLog(`Section ${section.id} contains no text. Caching silent fallback audio.`);
      const silentMp3 = Buffer.from('//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAAA', 'base64');
      fs.writeFileSync(localPath, silentMp3);
      await db.updateSection(section.id, { status: 'generated', audio_file_path: localPath });
      return silentMp3;
    }

    const rawVoice = chapter.voice_id || 'Aoede';
    const voiceName = getGcpVoiceName(rawVoice);
    let languageCode = 'en-US';
    if (voiceName.includes('-')) {
      const parts = voiceName.split('-');
      if (parts.length >= 2) languageCode = `${parts[0]}-${parts[1]}`;
    }

    request = {
      input: { text: textContent },
      voice: { languageCode, name: voiceName },
      audioConfig: { audioEncoding: 'MP3' },
    };
  }

  try {
    debugLog(`Generating audio for section ${section.id} (IsProTier: ${isProTier})`);
    debugLog(`TTS Request Payload for ${section.id}:\n${JSON.stringify(request, null, 2)}`);
    const [response] = await ttsClient.synthesizeSpeech(request);
    const audioBuffer = response.audioContent;

    fs.writeFileSync(localPath, audioBuffer);
    await db.updateSection(section.id, { status: 'generated', audio_file_path: localPath });
    debugLog(`Successfully cached audio for section ${section.id} (${audioBuffer.length} bytes)`);
    return audioBuffer;
  } catch (e) {
    console.error(`[TTS Error] Generating audio for section ${section.id}:`, e);
    console.error(`[TTS Error Stack]`, e.stack);
    if (e.details) console.error(`[TTS gRPC Details]`, e.details);
    if (e.code) console.error(`[TTS gRPC Code]`, e.code);
    debugLog(`Error generating audio for section ${section.id}: ${e.message}`);
    throw new Error(`TTS synthesis failed for section ${section.id}: ${e.message}`);
  }
}

// Reads a cached section's audio from disk, tolerating transient read
// failures (e.g. a GCS FUSE hiccup) by returning null so the caller can
// regenerate instead of aborting.
function readCachedSection(localPath, sectionId) {
  if (!fs.existsSync(localPath)) return null;
  try {
    return fs.readFileSync(localPath);
  } catch (e) {
    debugLog(`Error reading cached audio for ${sectionId}, regenerating: ${e.message}`);
    return null;
  }
}

app.post('/api/chapters/:chapterId/prepare', authMiddleware, async (req, res) => {
  const { chapterId } = req.params;
  const TIME_BUDGET_MS = 50000; // stay comfortably under typical intermediary timeouts

  const deadline = Date.now() + TIME_BUDGET_MS;
  let isClosed = false;
  req.on('close', () => { isClosed = true; });

  try {
    const chapter = await db.getChapter(chapterId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    const title = await db.getTitle(chapter.title_id, req.clientId, req.userId);
    if (!title) return res.status(403).json({ error: 'Forbidden' });

    const sections = await db.getSections(chapterId, 0);
    let generatedCount = 0;

    for (const section of sections) {
      if (isClosed) break;

      const localPath = path.join(audioDir, `${section.id}.mp3`);

      if (readCachedSection(localPath, section.id)) {
        generatedCount++;
        continue;
      }

      if (Date.now() > deadline) break; // out of budget this round - client will poll again

      const audioBuffer = await synthesizeAndCacheSection(title, chapter, section, localPath);
      if (audioBuffer) generatedCount++;
    }

    if (isClosed) return;

    res.json({
      totalSections: sections.length,
      generatedSections: generatedCount,
      ready: generatedCount === sections.length
    });
  } catch (error) {
    console.error(`[Prepare Endpoint Error] Chapter ${chapterId}:`, error);
    console.error(`[Prepare Stack]`, error.stack);
    debugLog(`Prepare error for ${chapterId}: ${error.message}`);
    if (!isClosed) res.status(500).json({ error: error.message });
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

    for (const section of sections) {
      if (isClosed) break;
      const localPath = path.join(audioDir, `${section.id}.mp3`);

      const audioBuffer = readCachedSection(localPath, section.id)
        || await synthesizeAndCacheSection(title, chapter, section, localPath);

      if (audioBuffer) res.write(audioBuffer);
    }
    if (!isClosed) res.end();
  } catch (error) {
    console.error(`[Stream Endpoint Error] Chapter ${chapterId}:`, error);
    console.error(`[Stream Stack]`, error.stack);
    debugLog(`Stream error for ${chapterId}: ${error.message}`);
    // Abort the connection instead of gracefully ending it, so the client's
    // fetch sees a failed request rather than a silently truncated "success".
    if (res.headersSent) {
      res.destroy();
    } else {
      res.status(500).json({ error: error.message });
    }
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
