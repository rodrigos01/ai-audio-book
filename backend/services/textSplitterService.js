const { v4: uuidv4 } = require('uuid');
const { parseSpeakerLine } = require('./scriptText');

// Splits a single unpunctuated run-on that alone exceeds the byte budget on
// word boundaries (a lone word longer than the budget is kept whole).
function splitOversizedSentence(sentence, prefix, maxBytes) {
  const budget = Math.max(1, maxBytes - Buffer.byteLength(prefix, 'utf8'));
  const pieces = [];
  let current = '';
  for (const word of sentence.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (Buffer.byteLength(candidate, 'utf8') > budget && current) {
      pieces.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function splitTextBySentences(bodyText, prefix = '', maxBytes = 600) {
  const sentences = bodyText.split(/(?<=[.!?])\s+/).flatMap(sentence =>
    Buffer.byteLength(`${prefix}${sentence}`, 'utf8') > maxBytes
      ? splitOversizedSentence(sentence, prefix, maxBytes)
      : [sentence]
  );
  const chunks = [];
  let currentSub = '';

  for (const s of sentences) {
    const candidate = currentSub ? `${currentSub} ${s}` : s;
    if (Buffer.byteLength(`${prefix}${candidate}`, 'utf8') > maxBytes && currentSub.length > 0) {
      chunks.push(`${prefix}${currentSub.trim()}`);
      currentSub = s;
    } else {
      currentSub = candidate;
    }
  }
  if (currentSub) {
    chunks.push(`${prefix}${currentSub.trim()}`);
  }
  return chunks;
}

function breakContentIntoSections(content, maxBytes = 600) {
  if (!content) return [];
  const paragraphs = content.split(/\r?\n\s*\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
  const sections = [];

  for (const p of paragraphs) {
    if (Buffer.byteLength(p, 'utf8') <= maxBytes) {
      sections.push(p);
    } else {
      sections.push(...splitTextBySentences(p, '', maxBytes));
    }
  }
  return sections;
}

function splitMultiSpeakerIntoSections(scriptText, maxBytes = 800, maxSpeakers = 2) {
  if (!scriptText) return [];

  const cleanText = scriptText.replace(/```[a-z]*\s*/gi, '').replace(/```/gi, '').trim();
  const rawLines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const turns = [];
  for (const line of rawLines) {
    const { speaker, text: dialogue } = parseSpeakerLine(line);
    const fullLine = `${speaker}: ${dialogue}`;

    if (Buffer.byteLength(fullLine, 'utf8') > maxBytes) {
      const chunks = splitTextBySentences(dialogue, `${speaker}: `, maxBytes);
      for (const chunk of chunks) {
        turns.push({ speaker, fullLine: chunk });
      }
    } else {
      turns.push({ speaker, fullLine });
    }
  }

  const sections = [];
  let currentLines = [];
  let currentSpeakers = new Set();
  let currentBytes = 0;

  for (const turn of turns) {
    const turnBytes = Buffer.byteLength(turn.fullLine, 'utf8');
    const willExceedSpeakers = !currentSpeakers.has(turn.speaker) && currentSpeakers.size >= maxSpeakers;
    const separatorBytes = currentLines.length > 0 ? 1 : 0;
    const willExceedBytes = currentBytes + separatorBytes + turnBytes > maxBytes;

    if ((willExceedSpeakers || willExceedBytes) && currentLines.length > 0) {
      sections.push(currentLines.join('\n'));
      currentLines = [turn.fullLine];
      currentSpeakers = new Set([turn.speaker]);
      currentBytes = turnBytes;
    } else {
      currentLines.push(turn.fullLine);
      currentSpeakers.add(turn.speaker);
      currentBytes += separatorBytes + turnBytes;
    }
  }

  if (currentLines.length > 0) {
    sections.push(currentLines.join('\n'));
  }

  return sections;
}

// Approximate spoken text of a section: strip speaker labels, leading style
// cues and inline <tags> so the duration estimate isn't inflated by markup.
function spokenTextOf(text) {
  return (text || '')
    .split(/\r?\n/)
    .map(line => parseSpeakerLine(line.trim()).text.replace(/^\([^)]{1,80}\)\s*/, ''))
    .join(' ')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function buildSectionItems(chapterId, sectionTexts) {
  let est = 0;
  return sectionTexts.map((text, index) => {
    const spokenText = spokenTextOf(text);
    const duration = spokenText.length > 0 ? spokenText.length / 14.5 + 0.5 : 0.5;
    const startTime = est;
    est += duration;
    return {
      id: uuidv4(),
      chapter_id: chapterId,
      section_index: index,
      content: text,
      status: 'pending',
      estimated_start_time: startTime,
      estimated_duration: duration
    };
  });
}

module.exports = {
  breakContentIntoSections,
  splitMultiSpeakerIntoSections,
  buildSectionItems,
  spokenTextOf
};
