// Shared parsing for the "Speaker: text" script format that AI casting emits and
// the splitter / TTS layers consume.
//
// Format: one turn per line, `Speaker: text`. A leading parenthetical on a
// turn's text (`Marlow: (whispering) Come closer.`) is a sustained-delivery
// style cue, sent as speech_metadata.style. Inline non-verbal tags such as
// <laugh> or <short pause> stay in the text for the TTS model to perform.

// Unicode-aware so accented names ("Chloé") are recognised as labels.
const SPEAKER_LINE = /^(\p{L}[\p{L}\p{M}0-9 .'_-]{0,39}):\s*(.*)$/u;

const NARRATOR = 'Narrator';

function parseSpeakerLine(line) {
  const match = line.match(SPEAKER_LINE);
  if (!match) return { speaker: NARRATOR, text: line.trim(), labeled: false };
  return { speaker: match[1].trim(), text: match[2].trim(), labeled: true };
}

// Pulls a leading "(style)" cue off a turn's text.
function extractStyle(text) {
  const m = text.match(/^\(([^)]{1,80})\)\s*(.*)$/s);
  if (!m) return { text, style: undefined };
  return { text: m[2].trim(), style: m[1].trim() };
}

// Parses a section's content into [{ speaker, text, style? }]. Unlabeled lines
// are narration.
function parseScriptTurns(content) {
  const turns = [];
  for (const raw of (content || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const { speaker, text } = parseSpeakerLine(line);
    const { text: body, style } = extractStyle(text);
    turns.push({ speaker, text: body, ...(style ? { style } : {}) });
  }
  return turns;
}

// Normalizes model-written script output: strips code fences and drops turns
// with nothing to speak (an empty "Speaker:" line would otherwise become an
// empty text item, which the TTS API rejects).
function cleanScript(script) {
  return (script || '')
    .replace(/```[a-z]*\s*/gi, '')
    .replace(/```/g, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(line => {
      if (!line) return false;
      const { text } = parseSpeakerLine(line);
      return text.replace(/^\([^)]*\)\s*/, '').trim().length > 0;
    })
    .join('\n');
}

function uniqueSpeakers(turns) {
  return [...new Set(turns.map(t => t.speaker))];
}

// Legacy (pre-Gemini-3.8) chapters stored Chirp3 SSML: <p><voice name="ID">..</voice></p>.
// Rebuilds script turns from it, mapping each voice id back to a character via
// the title's old casting_map (voice id -> name); anything unmapped is the
// narrator.
function isLegacySsml(content) {
  return /^\s*<speak\b/i.test(content || '');
}

function legacySsmlToTurns(ssml, castingMap = {}) {
  const voiceToName = {};
  for (const [name, voiceId] of Object.entries(castingMap || {})) {
    if (voiceId && !voiceToName[voiceId]) voiceToName[voiceId] = name;
  }
  const strip = s => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  const turns = [];
  const paragraphs = ssml.split(/<\/p>/i);
  for (const p of paragraphs) {
    const voiceRe = /<voice\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/voice>/gi;
    let last = 0;
    let m;
    const pushText = (raw, speaker) => {
      const text = strip(raw);
      if (text) turns.push({ speaker, text });
    };
    while ((m = voiceRe.exec(p)) !== null) {
      pushText(p.slice(last, m.index), NARRATOR);
      pushText(m[2], voiceToName[m[1]] || NARRATOR);
      last = m.index + m[0].length;
    }
    pushText(p.slice(last), NARRATOR);
  }
  return turns;
}

module.exports = {
  NARRATOR,
  SPEAKER_LINE,
  parseSpeakerLine,
  parseScriptTurns,
  cleanScript,
  uniqueSpeakers,
  extractStyle,
  isLegacySsml,
  legacySsmlToTurns,
};
