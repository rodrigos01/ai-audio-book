const textToSpeech = require('@google-cloud/text-to-speech');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const { debugLog } = require('./logger');
const audioStore = require('../stores/audioStore');
const firestoreStore = require('../stores/firestoreStore');
const admin = require('../firebase-config');

const GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';

if (!process.env.GEMINI_API_KEY) {
  debugLog('GEMINI_API_KEY not set. Pro-tier (Gemini) TTS synthesis will not work.');
}
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Human-readable title.language -> BCP-47 code understood by Gemini TTS's
// speechConfig.languageCode. Missing/unrecognized languages omit the field
// and let the model auto-detect from the prompt text instead.
const GEMINI_LANGUAGE_CODES = {
  'English': 'en-US',
  'Spanish': 'es-US',
  'French': 'fr-FR',
  'German': 'de-DE',
  'Italian': 'it-IT',
  'Portuguese': 'pt-BR',
  'Dutch': 'nl-NL',
  'Russian': 'ru-RU',
  'Japanese': 'ja-JP',
  'Korean': 'ko-KR',
  'Chinese': 'cmn-CN',
  'Mandarin Chinese': 'cmn-CN',
  'Arabic': 'ar-XA',
  'Hindi': 'hi-IN',
  'Polish': 'pl-PL',
  'Turkish': 'tr-TR',
  'Vietnamese': 'vi-VN',
  'Thai': 'th-TH',
  'Indonesian': 'id-ID',
  'Romanian': 'ro-RO',
  'Ukrainian': 'uk-UA',
  'Bengali': 'bn-IN',
  'Tamil': 'ta-IN',
  'Telugu': 'te-IN',
  'Marathi': 'mr-IN',
};

function getGeminiLanguageCode(languageName) {
  if (!languageName) return null;
  if (GEMINI_LANGUAGE_CODES[languageName]) return GEMINI_LANGUAGE_CODES[languageName];
  const found = Object.keys(GEMINI_LANGUAGE_CODES).find(k => k.toLowerCase() === languageName.toLowerCase());
  return found ? GEMINI_LANGUAGE_CODES[found] : null;
}

const SILENT_MP3 = Buffer.from('//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAAA', 'base64');
// A real ~1s silent clip synthesized through this same TTS pipeline (MP3,
// matching format), used as a fallback when synthesis itself fails -- see
// the catch block in synthesizeAndCacheSection. Distinct from SILENT_MP3
// above, which is a near-instant placeholder for sections with no
// speakable text at all, not an error fallback.
const SILENT_MP3_1S = fs.readFileSync(path.join(__dirname, '../assets/silent_1s.mp3'));

let ttsClient;
try {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../ai-audio-book-36e0611138d4.json');
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

  let clean = rawContent.replace(/```[a-z]*\s*/gi, '').replace(/```/gi, '').trim();
  clean = clean.replace(/<\/?speak\b[^>]*>/gi, '').trim();
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

function getLanguageCode(voiceName) {
  if (voiceName && voiceName.includes('-')) {
    const parts = voiceName.split('-');
    if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
  }
  return 'en-US';
}

const VALID_GEMINI_VOICES = new Set([
  'Achernar', 'Aoede', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome', 'Gacrux', 'Kore',
  'Laomedeia', 'Pulcherrima', 'Sulafat', 'Vindemiatrix', 'Zephyr', 'Orus', 'Achird',
  'Algenib', 'Algieba', 'Alnilam', 'Enceladus', 'Iapetus', 'Puck', 'Rasalgethi',
  'Sadachbia', 'Sadaltager', 'Schedar', 'Umbriel', 'Charon', 'Fenrir', 'Leda'
]);

function toGeminiVoiceId(voiceId) {
  if (!voiceId) return 'Aoede';
  const parts = voiceId.split('-');
  const shortName = parts[parts.length - 1];
  if (shortName === 'Orpheus') return 'Charon';
  if (shortName === 'Callisto') return 'Leda';
  if (VALID_GEMINI_VOICES.has(shortName)) return shortName;

  const found = [...VALID_GEMINI_VOICES].find(v => v.toLowerCase() === shortName.toLowerCase());
  if (found) return found;

  return null;
}

function extractSpeakerConfigsFromText(text, castingMap, narratorVoice) {
  const speakerConfigs = [];
  const addedAliases = new Set();
  const usedVoiceIds = new Set();

  const regex = /\b([a-zA-Z0-9]+):/g;
  let match;
  while ((match = regex.exec(text || '')) !== null) {
    const alias = match[1];
    if (!addedAliases.has(alias)) {
      let voiceId = null;

      if (castingMap && castingMap[alias]) {
        voiceId = toGeminiVoiceId(castingMap[alias]);
      }

      if (!voiceId && castingMap) {
        const foundKey = Object.keys(castingMap).find(k => k.toLowerCase() === alias.toLowerCase());
        if (foundKey) {
          voiceId = toGeminiVoiceId(castingMap[foundKey]);
        }
      }

      if (!voiceId) {
        voiceId = toGeminiVoiceId(alias);
      }

      if (!voiceId && alias.toLowerCase() === 'narrator') {
        voiceId = toGeminiVoiceId(narratorVoice);
      }

      if (!voiceId || usedVoiceIds.has(voiceId)) {
        const availableVoice = [...VALID_GEMINI_VOICES].find(v => !usedVoiceIds.has(v));
        if (availableVoice) {
          voiceId = availableVoice;
        } else if (!voiceId) {
          voiceId = toGeminiVoiceId(narratorVoice) || 'Aoede';
        }
      }

      speakerConfigs.push({ speakerAlias: alias, speakerId: voiceId });
      addedAliases.add(alias);
      usedVoiceIds.add(voiceId);
    }
  }

  if (speakerConfigs.length === 0) {
    const defaultNarrator = toGeminiVoiceId(narratorVoice) || 'Aoede';
    speakerConfigs.push({ speakerAlias: 'Narrator', speakerId: defaultNarrator });
  }

  return speakerConfigs;
}

async function deleteChapterSections(chapterId) {
  try {
    const sections = await firestoreStore.getSections(chapterId);
    const dbInstance = admin.firestore();
    const batch = dbInstance.batch();

    batch.update(dbInstance.collection('chapters').doc(chapterId), {
      audio_version: admin.firestore.FieldValue.increment(1)
    });

    if (sections.length === 0) {
      await batch.commit();
      return;
    }

    sections.forEach(s => {
      batch.delete(dbInstance.collection('chapter_sections').doc(s.id));
    });
    await Promise.all(sections.map(s => audioStore.deleteSectionAudio(s.id)));

    await batch.commit();
    debugLog(`Cleaned up ${sections.length} sections for chapter ${chapterId}`);
  } catch (e) {
    debugLog(`Failed during section cleanup: ${e.message}`);
  }
}

async function handleEmptySectionFallback(sectionId) {
  debugLog(`Section ${sectionId} contains no speakable text. Caching silent fallback audio.`);
  const audioPath = await audioStore.saveSectionAudio(sectionId, SILENT_MP3);
  await firestoreStore.updateSection(sectionId, {
    status: 'generated',
    audio_file_path: audioPath
  });
  return SILENT_MP3;
}

function buildSSMLRequest(ssmlContent, voiceId) {
  const voiceName = getGcpVoiceName(voiceId);
  return {
    input: { ssml: ssmlContent },
    voice: { languageCode: getLanguageCode(voiceName), name: voiceName },
    audioConfig: { audioEncoding: 'MP3' },
  };
}

function resolvePersona(personalities, alias, fallback) {
  if (personalities[alias]) return personalities[alias];
  const key = Object.keys(personalities).find(k => k.toLowerCase() === alias.toLowerCase());
  return key ? personalities[key] : fallback;
}

// Builds the single natural-language prompt (persona instructions + dialogue)
// and speaker/voice configuration for a Gemini multi-speaker TTS request via
// @google/genai -- simpler than the old @google-cloud/text-to-speech shape,
// which split the same information across separate input.prompt/input.text
// and voice.multiSpeakerVoiceConfig fields.
function buildProSynthesisPlan(textContent, title, chapter) {
  const castingMap = (title && title.casting_map) || {};
  const narratorVoice = (title && title.narrator_voice) || chapter.voice_id || 'Aoede';
  let speakerConfigs = extractSpeakerConfigsFromText(textContent, castingMap, narratorVoice);

  // Guarantee Gemini TTS multi-speaker limit of max 2 distinct speakers per request
  if (speakerConfigs.length > 2) {
    speakerConfigs = speakerConfigs.slice(0, 2);
  }

  const charPersonalities = (title && title.character_personalities) || (chapter && chapter.character_personalities) || {};
  const narratorPersona = (title && title.narrator_personality) || (chapter && chapter.narrator_personality) || "Calm, steady storyteller with clear tone";
  const deliveryInstruction = chapter && chapter.delivery_instruction;

  const promptLines = [];
  if (deliveryInstruction) {
    promptLines.push(deliveryInstruction, '');
  }

  let dialogueText = textContent;

  if (speakerConfigs.length >= 2) {
    promptLines.push("Synthesize speech according to these character personalities:", "", `Narrator: ${narratorPersona}`);

    for (const spk of speakerConfigs) {
      const alias = spk.speakerAlias;
      if (alias.toLowerCase() !== 'narrator') {
        const persona = resolvePersona(charPersonalities, alias, "Expressive, distinct character voice");
        promptLines.push(`${alias}: ${persona}`);
      }
    }
  } else {
    let singlePersona = narratorPersona;
    if (speakerConfigs.length === 1) {
      const alias = speakerConfigs[0].speakerAlias;
      if (alias.toLowerCase() !== 'narrator') {
        const persona = resolvePersona(charPersonalities, alias, null);
        if (persona) singlePersona = persona;
      }
    }
    promptLines.push(`Synthesize speech according to this personality: ${singlePersona}`);
    dialogueText = textContent.replace(/^([a-zA-Z0-9]+):\s*/gm, '').trim();
  }

  const languageName = (title && title.language) || 'English';
  if (languageName.toLowerCase() !== 'english') {
    promptLines.push(`The text below is written in ${languageName}; speak it naturally in ${languageName}.`);
  }

  const promptText = [...promptLines, '', dialogueText].join('\n');

  return {
    promptText,
    speakerConfigs,
    languageCode: getGeminiLanguageCode(languageName)
  };
}

function buildSpeechConfig(speakerConfigs, languageCode) {
  const speechConfig = {};
  if (languageCode) speechConfig.languageCode = languageCode;

  if (speakerConfigs.length >= 2) {
    speechConfig.multiSpeakerVoiceConfig = {
      speakerVoiceConfigs: speakerConfigs.map(c => ({
        speaker: c.speakerAlias,
        voiceConfig: { prebuiltVoiceConfig: { voiceName: c.speakerId } }
      }))
    };
  } else {
    const voiceName = speakerConfigs.length > 0 ? speakerConfigs[0].speakerId : 'Aoede';
    speechConfig.voiceConfig = { prebuiltVoiceConfig: { voiceName } };
  }

  return speechConfig;
}

function extractAudioPart(result) {
  const parts = (result && result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) || [];
  const audioPart = parts.find(p => p.inlineData && p.inlineData.mimeType && p.inlineData.mimeType.startsWith('audio/'));
  if (!audioPart) {
    const finishReason = result && result.candidates && result.candidates[0] && result.candidates[0].finishReason;
    throw new Error(`Gemini TTS returned no audio (finishReason: ${finishReason || 'unknown'})`);
  }

  const rateMatch = /rate=(\d+)/.exec(audioPart.inlineData.mimeType);
  const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
  const pcmBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
  return { pcmBuffer, sampleRate };
}

let mp3EncoderPromise;
function loadMp3Encoder() {
  // @breezystack/lamejs only ships an ESM build, so it must be dynamically
  // imported from this CommonJS module.
  if (!mp3EncoderPromise) mp3EncoderPromise = import('@breezystack/lamejs');
  return mp3EncoderPromise;
}

// Gemini TTS returns raw 16-bit signed little-endian PCM (mono), which the
// rest of the pipeline can't store/stream directly -- everything downstream
// (audioStore, HLS playlist/segment routes) assumes MP3 bytes -- so it's
// encoded to MP3 here via a pure-JS encoder rather than requiring ffmpeg.
async function pcmToMp3(pcmBuffer, sampleRate) {
  const { Mp3Encoder } = await loadMp3Encoder();
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = pcmBuffer.readInt16LE(i * 2);
  }

  const encoder = new Mp3Encoder(1, sampleRate, 64);
  const chunks = [];
  const blockSize = 1152;
  for (let i = 0; i < samples.length; i += blockSize) {
    const mp3buf = encoder.encodeBuffer(samples.subarray(i, i + blockSize));
    if (mp3buf.length > 0) chunks.push(Buffer.from(mp3buf));
  }
  const end = encoder.flush();
  if (end.length > 0) chunks.push(Buffer.from(end));

  return Buffer.concat(chunks);
}

async function synthesizeProTierSection(title, chapter, textContent) {
  const { promptText, speakerConfigs, languageCode } = buildProSynthesisPlan(textContent, title, chapter);
  const speechConfig = buildSpeechConfig(speakerConfigs, languageCode);
  const baseRequest = {
    model: GEMINI_TTS_MODEL,
    config: { responseModalities: ['AUDIO'], speechConfig }
  };

  let result;
  try {
    result = await genAI.models.generateContent({ ...baseRequest, contents: promptText });
  } catch (primaryErr) {
    const errStr = (primaryErr.message || '') + (primaryErr.details || '');
    if (/violation|content|safety|invalid_argument|blocked|policy/i.test(errStr)) {
      console.warn(`[Gemini TTS Safety Retry] Content violation detected. Retrying with sanitized text...`);
      result = await genAI.models.generateContent({ ...baseRequest, contents: sanitizeTextForSafety(promptText) });
    } else {
      throw primaryErr;
    }
  }

  const { pcmBuffer, sampleRate } = extractAudioPart(result);
  return pcmToMp3(pcmBuffer, sampleRate);
}

function buildBasicRequest(textContent, voiceId) {
  const voiceName = getGcpVoiceName(voiceId);
  return {
    input: { text: textContent },
    voice: { languageCode: getLanguageCode(voiceName), name: voiceName },
    audioConfig: { audioEncoding: 'MP3' },
  };
}

function sanitizeTextForSafety(text) {
  let clean = text.replace(/\[[^\]]*\]/g, '');
  clean = clean.replace(/[\u201C\u201D"]/g, "'").replace(/[\u2014\u2013]/g, ", ");
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean;
}

function sanitizeForContentViolation(request) {
  const retryReq = JSON.parse(JSON.stringify(request));
  if (retryReq.input && retryReq.input.text) {
    retryReq.input.text = sanitizeTextForSafety(retryReq.input.text);
  }
  return retryReq;
}

async function synthesizeAndCacheSection(title, chapter, section) {
  const isProTier = title && title.tts_tier === 'pro';
  const isSSML = !isProTier && chapter.is_ssml && (section.content || '').trim().startsWith('<speak>');

  const startTime = Date.now();
  try {
    let audioBuffer;

    if (isProTier) {
      const textContent = (section.content || '').replace(/<[^>]*>/g, '').trim();
      if (textContent.length === 0) {
        return handleEmptySectionFallback(section.id);
      }

      const msgStart = `[TTS Start] Section ${section.id} (IsProTier: true, model: ${GEMINI_TTS_MODEL})`;
      console.log(msgStart);
      debugLog(msgStart);

      audioBuffer = await synthesizeProTierSection(title, chapter, textContent);
    } else {
      let request;
      if (isSSML) {
        const ssmlContent = sanitizeSSML(section.content, true);
        const speakableText = (ssmlContent || '').replace(/<[^>]*>/g, '').trim();
        if (speakableText.length === 0) {
          return handleEmptySectionFallback(section.id);
        }
        request = buildSSMLRequest(ssmlContent, chapter.voice_id || 'en-US-Chirp3-HD-Aoede');
      } else {
        const textContent = (section.content || '').replace(/<[^>]*>/g, '').trim();
        if (textContent.length === 0) {
          return handleEmptySectionFallback(section.id);
        }
        request = buildBasicRequest(textContent, chapter.voice_id || 'Aoede');
      }

      const payloadBytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
      const msgStart = `[TTS Start] Section ${section.id} (IsProTier: false, PayloadSize: ${payloadBytes}B)`;
      console.log(msgStart);
      debugLog(msgStart);
      debugLog(`TTS Request Payload for ${section.id}:\n${JSON.stringify(request, null, 2)}`);

      let response;
      try {
        [response] = await ttsClient.synthesizeSpeech(request);
      } catch (primaryErr) {
        const errStr = (primaryErr.message || '') + (primaryErr.details || '');
        if (/violation|content|safety|invalid_argument|blocked|policy/i.test(errStr)) {
          console.warn(`[TTS Safety Retry] Content violation detected for section ${section.id}. Retrying with sanitized text heuristic...`);
          debugLog(`[TTS Safety Retry] Primary attempt failed for section ${section.id}: ${primaryErr.message}. Retrying with sanitized text...`);
          const retryRequest = sanitizeForContentViolation(request);
          [response] = await ttsClient.synthesizeSpeech(retryRequest);
        } else {
          throw primaryErr;
        }
      }

      audioBuffer = response.audioContent;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const audioPath = await audioStore.saveSectionAudio(section.id, audioBuffer);
    await firestoreStore.updateSection(section.id, { status: 'generated', audio_file_path: audioPath });
    const msgSuccess = `[TTS Success] Section ${section.id} completed in ${elapsed}s (${audioBuffer.length} bytes audio)`;
    console.log(msgSuccess);
    debugLog(msgSuccess);
    return audioBuffer;
  } catch (e) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const msgError = `[TTS Error] Section ${section.id} failed after ${elapsed}s: ${e.message}`;
    console.error(msgError);
    console.error(`[TTS Error Stack]`, e.stack);
    if (e.details) console.error(`[TTS gRPC Details]`, e.details);
    if (e.code) console.error(`[TTS gRPC Code]`, e.code);
    debugLog(msgError);

    // A section that keeps failing synthesis (bad input, persistent safety
    // rejection, API outage) must not leave callers waiting on a promise
    // that never resolves in a reasonable time or turns into a dead end for
    // an HLS segment that a player is blocking on. Cache a short silent clip
    // in its place -- same as handleEmptySectionFallback's "no speakable
    // text" case -- so it fails safe (skips ahead) instead of hanging, and
    // doesn't retry (and re-fail) on every future request for this section.
    console.error(`[TTS Fallback] Caching silent audio for section ${section.id} after synthesis failure`);
    debugLog(`[TTS Fallback] Caching silent audio for section ${section.id} after synthesis failure`);
    try {
      const audioPath = await audioStore.saveSectionAudio(section.id, SILENT_MP3_1S);
      await firestoreStore.updateSection(section.id, { status: 'generated', audio_file_path: audioPath });
    } catch (fallbackErr) {
      // Even caching/marking the fallback failed -- still must not leave the
      // caller hanging. It just won't be cached, so the next request retries
      // real synthesis instead of reusing this silent clip.
      console.error(`[TTS Fallback Error] Failed to cache silent audio for section ${section.id}: ${fallbackErr.message}`);
      debugLog(`[TTS Fallback Error] Failed to cache silent audio for section ${section.id}: ${fallbackErr.message}`);
    }
    return SILENT_MP3_1S;
  }
}

module.exports = {
  sanitizeSSML,
  getGcpVoiceName,
  toGeminiVoiceId,
  extractSpeakerConfigsFromText,
  deleteChapterSections,
  synthesizeAndCacheSection
};
