// Shared parsing for the "Speaker: text" script format that AI casting emits and
// the splitter / TTS layers consume.
//
// Format: one turn per line, `Speaker: text`, optionally followed by a
// `Style: ...` line that sets the turn's sustained delivery (e.g.
// `Style: whispering`). A leading parenthetical on the turn's text
// (`Marlow: (whispering) Come closer.`) is still accepted as a style cue.
// Inline non-verbal tags such as <laugh> or <short pause> stay in the text, as
// do `|backchannel|` reactions -- the TTS model voices those itself.

// Unicode-aware so accented names ("Chloé") are recognised as labels.
const SPEAKER_LINE = /^(\p{L}[\p{L}\p{M}0-9 .'_-]{0,39}):\s*(.*)$/u;

const NARRATOR = 'Narrator';

// A `Style: ...` line directly after a turn sets that turn's delivery style
// (speech_metadata.style), e.g. `Style: whispering`.
const STYLE_LINE = /^style:\s*(.*)$/i;

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
    const styleMatch = line.match(STYLE_LINE);
    if (styleMatch) {
      // Belongs to the turn above it; an orphan Style line is ignored.
      const prev = turns[turns.length - 1];
      if (prev && !prev.style && styleMatch[1].trim()) prev.style = styleMatch[1].trim();
      continue;
    }
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
  const out = [];
  let skipStyle = true; // a Style line with no turn above it is dropped
  for (const raw of (script || '').replace(/```[a-z]*\s*/gi, '').replace(/```/g, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (STYLE_LINE.test(line)) {
      if (!skipStyle && line.replace(STYLE_LINE, '$1').trim()) out.push(line);
      continue;
    }
    const { text } = parseSpeakerLine(line);
    const hasWords = text.replace(/^\([^)]*\)\s*/, '').trim().length > 0;
    skipStyle = !hasWords;
    if (hasWords) out.push(line);
  }
  return out.join('\n');
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
  STYLE_LINE,
  parseSpeakerLine,
  parseScriptTurns,
  cleanScript,
  uniqueSpeakers,
  extractStyle,
  isLegacySsml,
  legacySsmlToTurns,
};
