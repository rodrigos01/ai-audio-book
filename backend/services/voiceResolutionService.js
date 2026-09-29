// Resolves a script speaker label to a concrete Gemini TTS voice id for a title.
//
// title.voices[name] = {
//   kind: 'named' | 'supporting',   // decided by AI casting
//   description, gender, personality,
//   origin: 'design' | 'library' | null, voiceId: string | null,
//   fallback: boolean,              // resolved via the other path after a failure
//   hash: string | null,            // inputs the current voiceId was resolved from
// }
//
// Named characters (and the narrator) get a custom Voice Design voice; supporting
// characters get a Voice Library voice. Design is subject to a 200-voices-per-
// project quota, so a failed design falls back to the library. Titles created
// before this migration have no `voices` map: their casting_map / narrator_voice
// hold legacy Chirp3 / Gemini-prebuilt ids, mapped best-effort to library voices.
const crypto = require('crypto');
const firestoreStore = require('../stores/firestoreStore');
const gemini = require('./geminiTtsClient');
const { getLanguageCode } = require('./languageCodes');
const { NARRATOR } = require('./scriptText');
const { debugLog } = require('./logger');
const LEGACY_VOICES = require('../voices.json');

const PREBUILT_IDS = new Set([
  'achernar', 'aoede', 'autonoe', 'callirrhoe', 'despina', 'erinome', 'gacrux', 'kore',
  'laomedeia', 'pulcherrima', 'sulafat', 'vindemiatrix', 'zephyr', 'orus', 'achird',
  'algenib', 'algieba', 'alnilam', 'enceladus', 'iapetus', 'puck', 'rasalgethi',
  'sadachbia', 'sadaltager', 'schedar', 'umbriel', 'charon', 'fenrir', 'leda', 'zubenelgenubi',
]);
const DEFAULT_FEMALE = 'aoede';
const DEFAULT_MALE = 'charon';

const inFlight = new Map();

function normalizeGender(gender) {
  const g = (gender || '').toLowerCase();
  return g === 'male' || g === 'female' ? g : 'neutral';
}

function computeHash({ name, kind, description, gender, languageCode }) {
  return crypto.createHash('sha256')
    .update([name, kind || 'named', description || '', normalizeGender(gender), languageCode].join('\0'))
    .digest('hex')
    .slice(0, 32);
}

function findEntry(voices, label) {
  if (!voices) return null;
  if (voices[label]) return { name: label, entry: voices[label] };
  const key = Object.keys(voices).find(k => k.toLowerCase() === label.toLowerCase());
  return key ? { name: key, entry: voices[key] } : null;
}

// Maps an old Chirp3 / Journey / Gemini-prebuilt voice id to a library voice id.
function legacyVoiceToLibraryId(voiceId) {
  if (!voiceId) return DEFAULT_FEMALE;
  // Library ids (and designed voice ids) are lowercase; legacy ids are
  // "en-US-Chirp3-HD-Aoede" / "Aoede" style.
  if (/^[a-z0-9_-]+$/.test(voiceId)) return voiceId;
  const short = voiceId.split('-').pop().toLowerCase();
  if (short === 'orpheus') return 'charon';
  if (short === 'callisto') return 'leda';
  if (PREBUILT_IDS.has(short)) return short;
  const legacy = LEGACY_VOICES.find(v => v.id === voiceId);
  return legacy && legacy.gender && legacy.gender.toLowerCase() === 'male' ? DEFAULT_MALE : DEFAULT_FEMALE;
}

function usedVoiceIds(title, extra = []) {
  const ids = new Set(extra);
  for (const e of Object.values(title.voices || {})) if (e && e.voiceId) ids.add(e.voiceId);
  return ids;
}

async function designFor(title, name, entry, languageCode) {
  const voiceId = await gemini.designVoice({
    displayName: `${(title.name || 'Title').slice(0, 30)} - ${name}`.slice(0, 60),
    languageCode,
    gender: normalizeGender(entry.gender),
    voiceDescription: entry.description,
  });
  return { origin: 'design', voiceId, fallback: false };
}

async function libraryFor(title, name, entry, languageCode, exclude) {
  const match = await gemini.findLibraryVoice({
    languageCode,
    gender: normalizeGender(entry.gender) === 'neutral' ? undefined : normalizeGender(entry.gender),
    hint: `${entry.description || ''} ${entry.personality || ''}`,
    exclude,
  });
  return { origin: 'library', voiceId: match.id, fallback: false };
}

// (Re)resolves one character's voice from its title.voices entry and persists it.
async function resolveEntry(title, name, entry, exclude) {
  const languageCode = getLanguageCode(title.language);
  const hash = computeHash({ name, ...entry, languageCode });
  // `pinned` = the user explicitly picked this voice; never re-resolve it.
  if (entry.voiceId && (entry.pinned || entry.hash === hash)) return entry;

  const wantsDesign = entry.kind !== 'supporting' && !!entry.description;
  let resolved;
  if (wantsDesign) {
    try {
      resolved = await designFor(title, name, entry, languageCode);
    } catch (designErr) {
      // Most likely the 200-voices-per-project quota; fall back to the library.
      debugLog(`Voice design failed for "${name}" (${designErr.message}); falling back to Voice Library`);
      resolved = { ...(await libraryFor(title, name, entry, languageCode, exclude)), fallback: true };
    }
  } else {
    try {
      resolved = await libraryFor(title, name, entry, languageCode, exclude);
    } catch (libErr) {
      debugLog(`Voice Library search failed for "${name}" (${libErr.message}); using default voice`);
      resolved = { origin: 'library', voiceId: normalizeGender(entry.gender) === 'male' ? DEFAULT_MALE : DEFAULT_FEMALE, fallback: true };
    }
  }

  // Release the previous designed voice this one replaces (quota is per project).
  if (entry.origin === 'design' && entry.voiceId && entry.voiceId !== resolved.voiceId) {
    gemini.deleteVoice(entry.voiceId);
  }

  const next = { ...entry, ...resolved, hash };
  await firestoreStore.setTitleVoice(title.id, name, next);
  if (!title.voices) title.voices = {};
  title.voices[name] = next;
  return next;
}

function resolveEntryOnce(title, name, entry, exclude) {
  const key = `${title.id}:${name}`;
  if (!inFlight.has(key)) {
    inFlight.set(key, resolveEntry(title, name, entry, exclude).finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

/**
 * Returns { voiceId, languageCode } for a script speaker label. Also mutates
 * `title.voices` with any newly resolved entry so callers in the same request
 * see it.
 */
async function resolveVoice(title, label, { exclude } = {}) {
  const languageCode = getLanguageCode(title.language);
  const found = findEntry(title.voices, label);
  if (found && (found.entry.description || found.entry.voiceId)) {
    const entry = found.entry.description || found.entry.pinned
      ? await resolveEntryOnce(title, found.name, found.entry, exclude || usedVoiceIds(title))
      : found.entry;
    return { voiceId: entry.voiceId, languageCode };
  }

  // Legacy path: pre-migration title (no voices map) -- map old ids to the library.
  const isNarrator = label.toLowerCase() === NARRATOR.toLowerCase();
  const castKey = Object.keys(title.casting_map || {}).find(k => k.toLowerCase() === label.toLowerCase());
  const legacyId = isNarrator ? title.narrator_voice : (castKey ? title.casting_map[castKey] : title.narrator_voice);
  return { voiceId: legacyVoiceToLibraryId(legacyId), languageCode };
}

/**
 * Resolves voices for every entry in title.voices that needs one. Called after
 * casting so first play isn't blocked on design calls; failures are logged.
 */
async function resolveAllVoices(title) {
  const names = Object.keys(title.voices || {});
  // Sequential so library picks can exclude voices already assigned.
  for (const name of names) {
    try {
      await resolveVoice(title, name);
    } catch (err) {
      debugLog(`Could not eagerly resolve voice for "${name}": ${err.message}`);
    }
  }
}

// Deletes every designed voice a title owns (best-effort). Library voices aren't ours.
async function releaseTitleVoices(title) {
  const designed = Object.values(title.voices || {}).filter(e => e && e.origin === 'design' && e.voiceId);
  await Promise.all(designed.map(e => gemini.deleteVoice(e.voiceId)));
}

module.exports = {
  computeHash,
  findEntry,
  legacyVoiceToLibraryId,
  resolveVoice,
  resolveAllVoices,
  releaseTitleVoices,
  usedVoiceIds,
};
