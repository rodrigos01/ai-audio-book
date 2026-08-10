const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const path = require('path');
const { debugLog } = require('./logger');
const audioFileStore = require('../stores/audioFileStore');
const firestoreStore = require('../stores/firestoreStore');
const admin = require('../firebase-config');

const SILENT_MP3 = Buffer.from('//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAAA', 'base64');

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

  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^([a-zA-Z0-9]+):/);
    if (match) {
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
      audioFileStore.deleteSectionAudio(s.id);
    });

    await batch.commit();
    debugLog(`Cleaned up ${sections.length} sections for chapter ${chapterId}`);
  } catch (e) {
    debugLog(`Failed during section cleanup: ${e.message}`);
  }
}

async function handleEmptySectionFallback(sectionId) {
  debugLog(`Section ${sectionId} contains no speakable text. Caching silent fallback audio.`);
  audioFileStore.saveSectionAudio(sectionId, SILENT_MP3);
  await firestoreStore.updateSection(sectionId, {
    status: 'generated',
    audio_file_path: audioFileStore.getSectionAudioPath(sectionId)
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

function buildProRequest(textContent, title, chapter) {
  const castingMap = (title && title.casting_map) || {};
  const narratorVoice = (title && title.narrator_voice) || chapter.voice_id || 'Aoede';
  const speakerConfigs = extractSpeakerConfigsFromText(textContent, castingMap, narratorVoice);
  const performancePrompt = (chapter && chapter.performance_prompt)
    || "Synthesize the text as a multi-speaker dramatic audiobook performance with distinct character voices and natural emotional expressions.";

  if (speakerConfigs.length >= 2) {
    return {
      input: { prompt: performancePrompt, text: textContent },
      voice: {
        languageCode: 'en-US',
        modelName: 'gemini-3.1-flash-tts-preview',
        multiSpeakerVoiceConfig: { speakerVoiceConfigs: speakerConfigs }
      },
      audioConfig: { audioEncoding: 'MP3' }
    };
  }

  const singleVoice = speakerConfigs.length > 0 ? speakerConfigs[0].speakerId : toGeminiVoiceId(narratorVoice);
  const cleanSingleSpeakerText = textContent.replace(/^([a-zA-Z0-9]+):\s*/gm, '').trim();
  return {
    input: { prompt: performancePrompt, text: cleanSingleSpeakerText },
    voice: { languageCode: 'en-US', modelName: 'gemini-3.1-flash-tts-preview', name: singleVoice },
    audioConfig: { audioEncoding: 'MP3' }
  };
}

function buildBasicRequest(textContent, voiceId) {
  const voiceName = getGcpVoiceName(voiceId);
  return {
    input: { text: textContent },
    voice: { languageCode: getLanguageCode(voiceName), name: voiceName },
    audioConfig: { audioEncoding: 'MP3' },
  };
}

async function synthesizeAndCacheSection(title, chapter, section) {
  const isProTier = title && title.tts_tier === 'pro';
  const isSSML = !isProTier && chapter.is_ssml && (section.content || '').trim().startsWith('<speak>');
  let request;

  if (isSSML) {
    const ssmlContent = sanitizeSSML(section.content, true);
    const speakableText = (ssmlContent || '').replace(/<[^>]*>/g, '').trim();
    if (speakableText.length === 0) {
      return handleEmptySectionFallback(section.id);
    }
    request = buildSSMLRequest(ssmlContent, chapter.voice_id || 'en-US-Chirp3-HD-Aoede');
  } else if (isProTier) {
    const textContent = (section.content || '').replace(/<[^>]*>/g, '').trim();
    if (textContent.length === 0) {
      return handleEmptySectionFallback(section.id);
    }
    request = buildProRequest(textContent, title, chapter);
  } else {
    const textContent = (section.content || '').replace(/<[^>]*>/g, '').trim();
    if (textContent.length === 0) {
      return handleEmptySectionFallback(section.id);
    }
    request = buildBasicRequest(textContent, chapter.voice_id || 'Aoede');
  }

  const startTime = Date.now();
  try {
    const payloadBytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
    const msgStart = `[TTS Start] Section ${section.id} (IsProTier: ${isProTier}, PayloadSize: ${payloadBytes}B)`;
    console.log(msgStart);
    debugLog(msgStart);
    debugLog(`TTS Request Payload for ${section.id}:\n${JSON.stringify(request, null, 2)}`);

    const [response] = await ttsClient.synthesizeSpeech(request);
    const audioBuffer = response.audioContent;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const localPath = audioFileStore.saveSectionAudio(section.id, audioBuffer);
    await firestoreStore.updateSection(section.id, { status: 'generated', audio_file_path: localPath });
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
    throw new Error(`TTS synthesis failed for section ${section.id} after ${elapsed}s: ${e.message}`);
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
