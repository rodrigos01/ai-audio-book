const { debugLog } = require('./logger');
const audioStore = require('../stores/audioStore');
const firestoreStore = require('../stores/firestoreStore');
const admin = require('../firebase-config');
const gemini = require('./geminiTtsClient');
const { encodePcmToAac, getAdtsDurationSeconds, generateSilentAac } = require('./audioEncoder');
const { resolveVoice, usedVoiceIds } = require('./voiceResolutionService');
const { parseScriptTurns, uniqueSpeakers, isLegacySsml, legacySsmlToTurns } = require('./scriptText');

const MAX_SPEAKERS_PER_REQUEST = 2;

let silentClipPromise = null;
// ~1s silent AAC clip: stands in for a section when synthesis fails so an HLS
// player skips ahead instead of hanging. Never cached -- the section stays
// pending and the next request retries real synthesis.
function getSilentClip() {
  if (!silentClipPromise) silentClipPromise = generateSilentAac(1);
  return silentClipPromise;
}

// Concurrent requests for the same section (hls.js retries, prepare + playback)
// share one synthesis instead of double-billing.
const inFlight = new Map();

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

// Drops the cached audio of every section in a chapter that a speaker in
// `names` (case-insensitive) speaks, so it re-synthesizes on next play with the
// speaker's new voice. Legacy SSML sections can't be attributed cheaply and are
// always invalidated.
async function invalidateSpeakerAudio(chapterId, names) {
  const wanted = new Set(names.map(n => n.toLowerCase()));
  const sections = await firestoreStore.getSections(chapterId);
  const affected = sections.filter(s =>
    isLegacySsml(s.content) ||
    uniqueSpeakers(parseScriptTurns(s.content)).some(sp => wanted.has(sp.toLowerCase()))
  );
  if (affected.length === 0) return;

  await Promise.all(affected.map(async s => {
    await audioStore.deleteSectionAudio(s.id);
    await firestoreStore.updateSection(s.id, {
      status: 'pending',
      audio_file_path: admin.firestore.FieldValue.delete(),
      actual_duration: admin.firestore.FieldValue.delete(),
    });
  }));
  await firestoreStore.updateChapter(chapterId, { audio_version: admin.firestore.FieldValue.increment(1) });
  debugLog(`Invalidated ${affected.length} sections of chapter ${chapterId} for: ${names.join(', ')}`);
}

// Short cached sample of a voice, keyed by voice id so a re-designed voice
// (new id) gets a fresh sample. Stored through the audio store under a
// synthetic id.
async function synthesizePreview({ voiceId, languageCode, name }) {
  const key = `preview-${voiceId}-${languageCode || 'default'}`;
  const cached = await audioStore.readSectionAudio(key);
  if (cached) return cached;

  const text = name && name.toLowerCase() !== 'narrator'
    ? `Hello, I'm ${name}. This is how I sound.`
    : 'Hello, I will be your narrator. This is how I sound.';
  const pcm = await gemini.synthesizeTurns(
    [{ speaker: 'Preview', text }],
    [{ label: 'Preview', voiceId, languageCode }]
  );
  const audio = await encodePcmToAac(pcm);
  await audioStore.saveSectionAudio(key, audio);
  return audio;
}

async function cacheAudio(section, audioBuffer) {
  const audioPath = await audioStore.saveSectionAudio(section.id, audioBuffer);
  await firestoreStore.updateSection(section.id, {
    status: 'generated',
    audio_file_path: audioPath,
    actual_duration: getAdtsDurationSeconds(audioBuffer),
  });
}

async function handleEmptySection(section) {
  debugLog(`Section ${section.id} contains no speakable text. Caching silent audio.`);
  const silence = await generateSilentAac(0.5);
  await cacheAudio(section, silence);
  return silence;
}

// Splits turns into consecutive runs with at most `maxSpeakers` distinct
// speakers (Gemini TTS allows 2 per request). Sections produced by the
// splitter already satisfy this; legacy SSML paragraphs may not.
function groupTurnsBySpeakerLimit(turns, maxSpeakers = MAX_SPEAKERS_PER_REQUEST) {
  const groups = [];
  let current = [];
  let speakers = new Set();
  for (const turn of turns) {
    if (!speakers.has(turn.speaker) && speakers.size >= maxSpeakers) {
      groups.push(current);
      current = [];
      speakers = new Set();
    }
    current.push(turn);
    speakers.add(turn.speaker);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function sanitizeTurnsForContentViolation(turns) {
  return turns.map(t => ({
    ...t,
    text: t.text
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[“”"]/g, "'")
      .replace(/[—–]/g, ', ')
      .replace(/\s+/g, ' ')
      .trim(),
  }));
}

async function synthesizeGroup(turns, voices, sectionId) {
  try {
    return await gemini.synthesizeTurns(turns, voices);
  } catch (err) {
    if (/violation|safety|blocked|policy|usage guidelines/i.test(err.message)) {
      console.warn(`[TTS Safety Retry] Content rejection for section ${sectionId}; retrying with sanitized text`);
      return gemini.synthesizeTurns(sanitizeTurnsForContentViolation(turns), voices);
    }
    throw err;
  }
}

async function synthesize(title, chapter, section) {
  const content = section.content || '';
  const turns = (isLegacySsml(content) ? legacySsmlToTurns(content, title && title.casting_map) : parseScriptTurns(content))
    .filter(t => t.text.replace(/<[^>]*>/g, '').trim().length > 0);
  if (turns.length === 0) return handleEmptySection(section);

  const startTime = Date.now();
  console.log(`[TTS Start] Section ${section.id} (${turns.length} turns)`);

  // Resolve a voice per distinct speaker. Two labels resolving to the same
  // voice would be indistinguishable to the model, so merge the second into the
  // first's label.
  const labelVoices = new Map();
  const assigned = new Set();
  for (const label of uniqueSpeakers(turns)) {
    const voice = await resolveVoice(title, label, { exclude: usedVoiceIds(title, assigned) });
    if (assigned.has(voice.voiceId)) {
      const twin = [...labelVoices.entries()].find(([, v]) => v.voiceId === voice.voiceId);
      turns.forEach(t => { if (t.speaker === label) t.speaker = twin[0]; });
      continue;
    }
    assigned.add(voice.voiceId);
    labelVoices.set(label, voice);
  }

  const pcmParts = [];
  for (const group of groupTurnsBySpeakerLimit(turns)) {
    const voices = uniqueSpeakers(group).map(label => ({ label, ...labelVoices.get(label) }));
    pcmParts.push(await synthesizeGroup(group, voices, section.id));
  }

  const audioBuffer = await encodePcmToAac(Buffer.concat(pcmParts));
  await cacheAudio(section, audioBuffer);
  console.log(`[TTS Success] Section ${section.id} in ${((Date.now() - startTime) / 1000).toFixed(2)}s (${audioBuffer.length} bytes AAC)`);
  return audioBuffer;
}

// Synthesizes a section and caches it. Throws on failure (callers that must not
// treat a failure as success, e.g. offline download prep, want that).
function synthesizeAndCacheSection(title, chapter, section) {
  if (!inFlight.has(section.id)) {
    const p = synthesize(title, chapter, section).finally(() => inFlight.delete(section.id));
    inFlight.set(section.id, p);
  }
  return inFlight.get(section.id);
}

// Playback flavour: on failure serve transient silence (not cached) so the
// player skips ahead, and leave the section pending so it retries next time.
async function synthesizeOrSilence(title, chapter, section) {
  try {
    return { audioBuffer: await synthesizeAndCacheSection(title, chapter, section), failed: false };
  } catch (e) {
    console.error(`[TTS Error] Section ${section.id} failed: ${e.message}`);
    debugLog(`[TTS Error] Section ${section.id} failed: ${e.message}`);
    return { audioBuffer: await getSilentClip(), failed: true };
  }
}

module.exports = {
  deleteChapterSections,
  synthesizeAndCacheSection,
  synthesizeOrSilence,
  invalidateSpeakerAudio,
  synthesizePreview,
  groupTurnsBySpeakerLimit,
};
