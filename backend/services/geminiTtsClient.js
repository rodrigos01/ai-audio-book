// Gemini 3.8 Flash TTS via @google/genai's `interactions` / `voices` API,
// ported from ai-podcasts-api's src/llm/ttsClient.ts. Only reachable through
// the AI Studio (API key) backend -- Vertex doesn't expose it on this project.
//
// Synthesis is synchronous from the caller's point of view: the streaming call
// is consumed to completion server-side and the PCM buffered (no low-latency
// streaming to the client).
const { GoogleGenAI } = require('@google/genai');
const { debugLog } = require('./logger');

const TTS_MODEL = 'gemini-3.8-flash-tts';
const SAMPLE_RATE = 24000; // PCM s16le, mono
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
// interactions.create rejects a request whose audio would exceed ~300s, and a
// stalled stream can't be resumed (confirmed in ai-podcasts-api).
const MAX_AUDIO_SECONDS = 300;
const STREAM_INACTIVITY_TIMEOUT_MS = 20000;
const MAX_OTHER_EVENTS_LOGGED = 10;

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set; Gemini TTS is unavailable.');
    }
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
        const slow = err.status === 429 || looksLikeModerationRejection(err);
        await sleep(slow ? 2 ** attempt * 1000 : attempt * 500);
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

async function designVoice({ displayName, languageCode, gender, voiceDescription }) {
  const voice = await withBackoff(() => getClient().voices.create({
    store: true,
    voice: {
      type: 'prompted',
      display_name: displayName,
      language_code: languageCode,
      gender,
      prompted: { input: voiceDescription },
    },
  }), 3);
  if (!voice.id) throw new Error('Voice Design did not return a voice id');
  return voice.id;
}

// Best-effort: a leaked (quota-counted) voice is a smaller problem than a
// failed request, so errors are logged and swallowed.
async function deleteVoice(voiceId) {
  try {
    await getClient().voices.delete(voiceId);
  } catch (err) {
    debugLog(`Failed to delete designed voice ${voiceId}: ${err.message}`);
  }
}

function libraryParams(raw) {
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
}

// Lists prebuilt library voices. Returns [{ id, name, gender?, ... }].
async function listLibraryVoices({ languageCode, gender, accent, personaKeywords, pageSize = 10 } = {}) {
  const res = await withBackoff(() => getClient().voices.list(libraryParams({
    language_code: languageCode ? [languageCode] : undefined,
    gender: gender ? [gender] : undefined,
    accent: accent ? [accent] : undefined,
    persona: personaKeywords && personaKeywords.length ? personaKeywords : undefined,
    type: ['prebuilt'],
    page_size: pageSize,
  })), 3);
  return (res.voices || []).filter(v => v.id).map(v => ({ id: v.id, name: v.display_name || v.id, raw: v }));
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

// Progressively looser search: the tightest filter combination often returns
// nothing, so drop filters tier by tier. Throws if nothing usable matches.
async function findLibraryVoice({ languageCode, gender, accent, hint, exclude }) {
  const ladder = [
    { languageCode, gender, accent },
    { languageCode, gender },
    { languageCode },
  ];
  for (const filters of ladder) {
    const voices = await listLibraryVoices({ ...filters, pageSize: 50 });
    const best = pickBestVoice(voices, { hint, exclude });
    if (best) return best;
  }
  throw new Error(`No Voice Library match found (language ${languageCode})`);
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

// Turns with no spoken text are dropped: the API rejects an empty text item
// outright ("400 Missing text in content of type text").
function buildContentItems(turns, multiSpeaker) {
  return turns
    .filter(turn => turn.text.trim().length > 0)
    .map(turn => {
      const annotation = { type: 'speech_metadata' };
      if (multiSpeaker) annotation.speaker = turn.speaker;
      if (turn.style) annotation.style = turn.style;
      return {
        type: 'text',
        text: turn.text.replace(/\[/g, '<').replace(/\]/g, '>').trim(),
        annotations: annotation.speaker || annotation.style ? [annotation] : undefined,
      };
    });
}

// A section where every turn shares one speaker must not declare a second,
// silent voice (causes hallucinated interjections).
function soloSpeakerLabel(turns) {
  if (turns.length === 0) return null;
  return turns.every(t => t.speaker === turns[0].speaker) ? turns[0].speaker : null;
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
    const event = result.value;
    if (event && event.event_type === 'step.delta' && event.delta && event.delta.type === 'audio') {
      if (event.delta.data) {
        const pcm = Buffer.from(event.delta.data, 'base64');
        chunks.push(pcm);
        totalBytes += pcm.length;
        if (totalBytes / BYTES_PER_SECOND > MAX_AUDIO_SECONDS) {
          throw new Error(`Audio exceeded ${MAX_AUDIO_SECONDS}s -- aborting a likely runaway TTS response`);
        }
      }
    } else if (otherEvents.length < MAX_OTHER_EVENTS_LOGGED) {
      try { otherEvents.push(JSON.stringify(event).slice(0, 500)); } catch { otherEvents.push(String(event)); }
    }
  }
  return { pcm: Buffer.concat(chunks), otherEvents };
}

/**
 * Synthesizes turns ([{ speaker, text, style? }]) to raw PCM (s16le, 24kHz,
 * mono). `voices` is [{ label, voiceId, languageCode? }] -- at most 2 distinct
 * speakers per call (a 3.8 limit). Resolves once the whole stream is consumed.
 */
async function synthesizeTurns(turns, voices) {
  const soloLabel = soloSpeakerLabel(turns);
  const activeVoices = soloLabel ? voices.filter(v => v.label === soloLabel) : voices;
  if (activeVoices.length === 0) throw new Error('No voice assigned for the section speakers');
  if (activeVoices.length > 2) throw new Error('Gemini TTS supports at most 2 speakers per request');
  const multiSpeaker = activeVoices.length > 1;
  const content = buildContentItems(turns, multiSpeaker);
  if (content.length === 0) throw new Error('No speakable text');

  const params = {
    model: TTS_MODEL,
    input: [{ type: 'user_input', content }],
    response_format: { type: 'audio' },
    generation_config: {
      speech_config: {
        mode: 'conversational',
        speakers: activeVoices.map(v => ({
          ...(multiSpeaker ? { speaker: v.label } : {}),
          voice: v.voiceId,
          ...(v.languageCode ? { language: v.languageCode } : {}),
        })),
      },
    },
    stream: true,
  };

  const attempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const stream = await getClient().interactions.create(params);
      const { pcm, otherEvents } = await consumeStream(stream);
      if (pcm.length === 0) {
        throw new Error(otherEvents.length > 0
          ? `Gemini TTS stream produced no audio data (saw: ${otherEvents.join(' | ')})`
          : 'Gemini TTS stream produced no audio data (stream ended with no events at all)');
      }
      return pcm;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await sleep(looksLikeModerationRejection(err) ? 2 ** attempt * 1000 : attempt * 1000);
      }
    }
  }
  const status = lastError && lastError.status;
  const wrapped = new Error(`Gemini TTS synthesis failed: ${[status, lastError && lastError.message].filter(Boolean).join(' ')}`);
  wrapped.cause = lastError;
  throw wrapped;
}

module.exports = {
  TTS_MODEL,
  SAMPLE_RATE,
  BYTES_PER_SECOND,
  designVoice,
  deleteVoice,
  listLibraryVoices,
  findLibraryVoice,
  buildContentItems,
  soloSpeakerLabel,
  synthesizeTurns,
  looksLikeModerationRejection,
};
