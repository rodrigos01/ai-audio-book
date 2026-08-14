const { v4: uuidv4 } = require('uuid');

function splitTextBySentences(bodyText, prefix = '', maxBytes = 600) {
  const sentences = bodyText.split(/(?<=[.!?])\s+/);
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

function splitSSMLIntoSections(ssml) {
  if (!ssml) return [];
  let clean = ssml.replace(/```[a-z]*\s*/gi, '').replace(/```/gi, '').trim();
  clean = clean.replace(/<\/?speak>/gi, '').trim();

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

    const speakableText = trimmed.replace(/<[^>]*>/g, '').trim();
    if (speakableText.length > 0) {
      validSections.push(`<speak>${trimmed}</speak>`);
    }
  }

  return validSections;
}

function splitMultiSpeakerIntoSections(scriptText, maxBytes = 4000, maxSpeakers = 2) {
  if (!scriptText) return [];

  const cleanText = scriptText.replace(/```[a-z]*\s*/gi, '').replace(/```/gi, '').trim();
  const rawLines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const turns = [];
  for (const line of rawLines) {
    const match = line.match(/^([a-zA-Z0-9_ -]{1,40}):\s*(.*)$/);
    const speaker = match ? match[1].trim() : 'Narrator';
    const dialogue = match ? match[2].trim() : line;
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

function buildSectionItems(chapterId, sectionTexts) {
  let est = 0;
  return sectionTexts.map((text, index) => {
    const spokenText = (text || '').replace(/<[^>]*>/g, '').trim();
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
  splitSSMLIntoSections,
  splitMultiSpeakerIntoSections,
  buildSectionItems
};
