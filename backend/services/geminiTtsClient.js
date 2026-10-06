// Gemini 3.8 Flash TTS through the Gemini Enterprise API (`enterprise: true`,
// aiplatform.googleapis.com, Application Default Credentials -- the Cloud Run
// service account / GOOGLE_APPLICATION_CREDENTIALS). Docs:
//   .../models/text-to-speech/overview   (generateContent / multi-speaker)
//   .../models/text-to-speech/voice-design (Voices API)
//
// Synthesis is synchronous from the caller's point of view: the streaming
// response is consumed to completion server-side and the PCM buffered (no
// low-latency streaming to the client).
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
const { debugLog } = require('./logger');

const TTS_MODEL = 'gemini-3.8-flash-tts';
const SAMPLE_RATE = 24000; // PCM s16le, mono
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
// A request's audio is capped (~300s); a stalled stream can't be resumed.
const MAX_AUDIO_SECONDS = 300;
const STREAM_INACTIVITY_TIMEOUT_MS = 20000;
const MAX_OTHER_EVENTS_LOGGED = 10;
// Voice design generates a sample, so it takes ~10-25s per voice.
const DESIGN_TIMEOUT_MS = 60000;
const DESIGN_ATTEMPTS = 2;
const LIBRARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function getProject() {
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (keyPath && fs.existsSync(keyPath)) {
      const { project_id: projectId } = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      if (projectId) return projectId;
    }
  } catch { /* fall through */ }
  return 'ai-audio-book';
}

let client = null;
function getClient() {
  if (!client) {
    client = new GoogleGenAI({ enterprise: true, project: getProject(), location: 'global' });
  }
  return client;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function looksLikeModerationRejection(err) {
  return err instanceof Error && /usage guidelines|safety|blocked/i.test(err.message);
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function withBackoff(fn, attempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        // RESOURCE_EXHAUSTED (per-minute create quota) needs a real wait.
        const slow = err.status === 429 || looksLikeModerationRejection(err);
        await sleep(slow ? 2 ** attempt * 1000 : attempt * 500);
      }
    }
  }
  throw lastError;
}

// Stored (designed / replicated) voices are `voice_...`; stateless replicated
// keys are `voicekey_...`. Everything else is a prebuilt / Voice Library id.
function isCustomVoiceId(voiceId) {
  return /^voice(key)?_/.test(voiceId || '');
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

const TEXT_MODEL = 'gemini-3.8-flash';

// Voice design is sensitive to the wording of the description: some prompts
// (observed: "low, gravelly baritone ... measured cadence") hang or 500 while a
// plainer rewording succeeds in ~15s -- the API's own error says "Try
// rephrasing the prompt". On failure we ask Gemini for a simpler version.
async function simplifyVoiceDescription(description) {
  try {
    const res = await getClient().models.generateContent({
      model: TEXT_MODEL,
      contents: `Rewrite this voice description as ONE plain, concrete sentence a voice-generation model can follow: age, gender, pitch, pace and accent in everyday words. Avoid musical or technical jargon and flowery metaphors. Output only the sentence.\n\n${description}`,
    });
    const text = (res.text || '').trim().replace(/^["']|["']$/g, '');
    return text.length >= 20 ? text : description;
  } catch (err) {
    debugLog(`Could not simplify voice description (${err.message}); retrying with the original`);
    return description;
  }
}

// Designs a voice from a natural-language description. Observed live: ~15-25s
// per voice normally, but prompt-dependent hangs / 500s, and a per-project
// per-minute create quota (429 RESOURCE_EXHAUSTED -- don't design voices in
// parallel). The SDK's own retries are disabled so the timeout is a real
// ceiling; callers fall back to the Voice Library when this throws.
async function designVoice({ displayName, languageCode, gender, voiceDescription }) {
  let description = voiceDescription;
  let lastError;
  for (let attempt = 1; attempt <= DESIGN_ATTEMPTS; attempt++) {
    try {
      // The SDK's own `timeout` isn't reliably enforced (a failing prompt ran
      // ~150s), so impose a hard ceiling. A request that completes after we gave
      // up would leave an untracked voice behind: delete it when it lands.
      const pending = getClient().voices.create({
        store: true,
        voice: {
          type: 'VOICE_TYPE_PROMPTED',
          display_name: displayName,
          language_code: languageCode,
          gender,
          prompted: { input: description },
        },
      }, undefined, { timeout: DESIGN_TIMEOUT_MS, maxRetries: 0 });
      let timedOut = false;
      pending.then(v => { if (timedOut && v && v.id) deleteVoice(v.id); }, () => {});
      const voice = await withTimeout(pending, DESIGN_TIMEOUT_MS, `Voice design timed out after ${DESIGN_TIMEOUT_MS / 1000}s`)
        .catch(err => { timedOut = true; throw err; });
      if (!voice.id) throw new Error('Voice Design did not return a voice id');
      return voice.id;
    } catch (err) {
      lastError = err;
      debugLog(`Voice design attempt ${attempt} failed: ${String(err.message).replace(/\s+/g, ' ').slice(0, 160)}`);
      if (attempt < DESIGN_ATTEMPTS) {
        if (err.status === 429) await sleep(20000);
        description = await simplifyVoiceDescription(voiceDescription);
      }
    }
  }
  throw lastError;
}

// Best-effort: a leaked voice (it expires a year after last use anyway) is a
// smaller problem than a failed request, so errors are logged and swallowed.
async function deleteVoice(voiceId) {
  if (!isCustomVoiceId(voiceId)) return; // prebuilt/library voices aren't ours
  try {
    await getClient().voices.delete(voiceId);
  } catch (err) {
    debugLog(`Failed to delete designed voice ${voiceId}: ${err.message}`);
  }
}

// Does a stored voice exist on this API? (404 = no; anything else = assume yes.)
async function voiceExists(voiceId) {
  try {
    await getClient().voices.get(voiceId);
    return true;
  } catch (err) {
    return err.status !== 404;
  }
}

let libraryCache = null; // { voices, fetchedAt }
let libraryInFlight = null;

// The whole prebuilt + Extended Voice Library catalog (~2,100 voices). The list
// method can only filter on `type` and `search` (language/gender filters 400),
// 50 per page, so crawl it once (~4s) and filter locally.
async function loadLibrary() {
  if (libraryCache && Date.now() - libraryCache.fetchedAt < LIBRARY_CACHE_TTL_MS) return libraryCache.voices;
  if (!libraryInFlight) {
    libraryInFlight = (async () => {
      const all = [];
      let pageToken;
      do {
        const res = await withBackoff(() => getClient().voices.list({
          type_: ['prebuilt'],
          page_size: 50,
          ...(pageToken ? { page_token: pageToken } : {}),
        }), 3);
        all.push(...(res.voices || []));
        pageToken = res.next_page_token;
      } while (pageToken);
      // list returns the project's own stored voices first, even when filtered.
      const voices = all.filter(v => v.id && !isCustomVoiceId(v.id) && v.language_code)
        .map(v => ({ id: v.id, name: v.display_name || v.id, raw: v }));
      libraryCache = { voices, fetchedAt: Date.now() };
      return voices;
    })().finally(() => { libraryInFlight = null; });
  }
  return libraryInFlight;
}

// "es-US" matches voices tagged es-US, else any es-*; case-insensitive.
function languageMatches(voiceLang, wanted) {
  const a = (voiceLang || '').toLowerCase();
  const b = (wanted || '').toLowerCase();
  if (!b) return true;
  return a === b || a.split('-')[0] === b.split('-')[0];
}

// Library voices, optionally narrowed by language / gender / accent. When a
// language has an exact-region match (en-US) those are preferred over siblings.
async function listLibraryVoices({ languageCode, gender, accent, pageSize = 100 } = {}) {
  const all = await loadLibrary();
  let voices = all.filter(v => languageMatches(v.raw.language_code, languageCode));
  const exact = voices.filter(v => (v.raw.language_code || '').toLowerCase() === (languageCode || '').toLowerCase());
  if (exact.length > 0) voices = exact;
  if (gender) voices = voices.filter(v => (v.raw.gender || '').toLowerCase() === gender.toLowerCase());
  if (accent) voices = voices.filter(v => (v.raw.accent || '').toLowerCase().includes(accent.toLowerCase()));
  return voices.slice(0, pageSize);
}

function keywords(text) {
  return new Set((text || '').toLowerCase().match(/[a-z]{4,}/g) || []);
}

// Picks the library voice whose description best overlaps `hint`, skipping ids
// in `exclude` so different characters don't all land on the same voice.
function pickBestVoice(voices, { hint, exclude }) {
  const candidates = voices.filter(v => !exclude || !exclude.has(v.id));
  if (candidates.length === 0) return null;
  const want = keywords(hint);
  let best = candidates[0];
  let bestScore = -1;
  for (const v of candidates) {
    const have = keywords(`${v.raw.description || ''} ${v.raw.persona || ''} ${v.raw.accent || ''}`);
    let score = 0;
    for (const w of want) if (have.has(w)) score += 1;
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}

// Progressively looser search: drop filters tier by tier. Throws if nothing
// usable matches.
async function findLibraryVoice({ languageCode, gender, accent, hint, exclude }) {
  const ladder = [
    { languageCode, gender, accent },
    { languageCode, gender },
    { languageCode },
  ];
  for (const filters of ladder) {
    const voices = await listLibraryVoices({ ...filters, pageSize: 500 });
    const best = pickBestVoice(voices, { hint, exclude });
    if (best) return best;
  }
  throw new Error(`No Voice Library match found (language ${languageCode})`);
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

// `|reaction|` segments are backchannels: a listener's brief reaction layered
// over the speaker. Only a two-speaker request can voice them (the model
// assigns them to the other speaker); with a single speaker they'd be read as
// stray text, so they are dropped there.
function stripBackchannels(text) {
  return text.replace(/\|[^|]*\|/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

// Turns with no spoken text are dropped: the API rejects an empty text part.
// `[` / `]` would be read as tags, so they are rewritten to `<` / `>`.
function buildParts(turns, { multiSpeaker, backchannels }) {
  return turns
    .map(turn => ({ ...turn, text: backchannels ? turn.text : stripBackchannels(turn.text) }))
    .filter(turn => turn.text.trim().length > 0)
    .map(turn => {
      const speechMetadata = {};
      if (multiSpeaker) speechMetadata.speaker = turn.speaker;
      if (turn.style) speechMetadata.style = turn.style;
      return {
        text: turn.text.replace(/\[/g, '<').replace(/\]/g, '>').trim(),
        ...(Object.keys(speechMetadata).length > 0 ? { speechMetadata } : {}),
      };
    });
}

async function consumeStream(stream) {
  const chunks = [];
  let totalBytes = 0;
  const otherEvents = [];
  const iterator = stream[Symbol.asyncIterator]();
  for (;;) {
    const result = await withTimeout(
      iterator.next(),
      STREAM_INACTIVITY_TIMEOUT_MS,
      `Gemini TTS stream stalled: no event for ${STREAM_INACTIVITY_TIMEOUT_MS / 1000}s`
    );
    if (result.done) break;
    const parts = (result.value && result.value.candidates && result.value.candidates[0]
      && result.value.candidates[0].content && result.value.candidates[0].content.parts) || [];
    let sawAudio = false;
    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        sawAudio = true;
        // Streaming responses are headerless 16-bit PCM (audio/l16, 24 kHz, mono).
        const pcm = Buffer.from(part.inlineData.data, 'base64');
        chunks.push(pcm);
        totalBytes += pcm.length;
        if (totalBytes / BYTES_PER_SECOND > MAX_AUDIO_SECONDS) {
          throw new Error(`Audio exceeded ${MAX_AUDIO_SECONDS}s -- aborting a likely runaway TTS response`);
        }
      }
    }
    if (!sawAudio && otherEvents.length < MAX_OTHER_EVENTS_LOGGED) {
      try { otherEvents.push(JSON.stringify(result.value).slice(0, 500)); } catch { otherEvents.push(String(result.value)); }
    }
  }
  return { pcm: Buffer.concat(chunks), otherEvents };
}

// One generateContentStream call -> raw PCM. `speechConfig` is either
// { voiceConfig: { voice } } or { multiSpeakerVoiceConfig: {...} }.
async function synthesizeRequest(parts, speechConfig) {
  if (parts.length === 0) throw new Error('No speakable text');
  const request = {
    model: TTS_MODEL,
    contents: [{ role: 'user', parts }],
    config: { responseModalities: ['AUDIO'], speechConfig },
  };

  const attempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const stream = await getClient().models.generateContentStream(request);
      const { pcm, otherEvents } = await consumeStream(stream);
      if (pcm.length === 0) {
        throw new Error(otherEvents.length > 0
          ? `Gemini TTS stream produced no audio data (saw: ${otherEvents.join(' | ')})`
          : 'Gemini TTS stream produced no audio data (stream ended with no events at all)');
      }
      return pcm;
    } catch (err) {
      lastError = err;
      if (err.status === 404) break; // a missing voice won't appear on retry
      if (attempt < attempts) {
        await sleep(looksLikeModerationRejection(err) ? 2 ** attempt * 1000 : attempt * 1000);
      }
    }
  }
  const status = lastError && lastError.status;
  const wrapped = new Error(`Gemini TTS synthesis failed: ${[status, lastError && lastError.message].filter(Boolean).join(' ')}`);
  wrapped.cause = lastError;
  wrapped.status = status;
  // A stored voice that no longer exists (deleted, expired after a year unused,
  // or created through a different API surface such as the old AI Studio one).
  wrapped.voiceNotFound = status === 404 && /voice/i.test(String(lastError && lastError.message));
  throw wrapped;
}

/**
 * Synthesizes turns ([{ speaker, text, style? }]) to raw PCM (s16le, 24kHz,
 * mono). `voices` is [{ label, voiceId }] for each distinct speaker (at most 2
 * per call). The model detects the language from the text.
 *
 *  - one speaker  -> single-speaker request
 *  - two speakers -> one multi-speaker request, with `|backchannel|` reactions
 *                    voiced by the other speaker
 *
 * Designed (voice_...) voices work in multi-speaker requests even though the
 * docs say to synthesize such turns individually.
 */
async function synthesizeTurns(turns, voices) {
  const speakers = [...new Set(turns.map(t => t.speaker))];
  const voiceFor = label => {
    const v = voices.find(x => x.label === label);
    if (!v) throw new Error(`No voice assigned for speaker "${label}"`);
    return v.voiceId;
  };
  if (speakers.length === 0) throw new Error('No speakable text');
  if (speakers.length > 2) throw new Error('Gemini TTS supports at most 2 speakers per request');

  if (speakers.length === 1) {
    const parts = buildParts(turns, { multiSpeaker: false, backchannels: false });
    return synthesizeRequest(parts, { voiceConfig: { voice: voiceFor(speakers[0]) } });
  }

  // Exactly two speakers, both configured.
  const parts = buildParts(turns, { multiSpeaker: true, backchannels: true });
  return synthesizeRequest(parts, {
    multiSpeakerVoiceConfig: {
      speakerVoiceConfigs: speakers.map(label => ({ speaker: label, voiceConfig: { voice: voiceFor(label) } })),
    },
  });
}

module.exports = {
  getClient,
  TTS_MODEL,
  SAMPLE_RATE,
  BYTES_PER_SECOND,
  isCustomVoiceId,
  designVoice,
  deleteVoice,
  voiceExists,
  listLibraryVoices,
  findLibraryVoice,
  stripBackchannels,
  buildParts,
  synthesizeTurns,
  looksLikeModerationRejection,
};
