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

function splitMultiSpeakerIntoSections(scriptText, maxBytes = 600) {
  if (!scriptText) return [];
  let clean = scriptText.replace(/```[a-z]*\s*/gi, '').replace(/```/gi, '').trim();
  clean = clean.replace(/([^\n])\b([a-zA-Z0-9]+:)/g, '$1\n$2');

  const rawLines = clean.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const lines = [];

  for (const line of rawLines) {
    const lineLen = Buffer.byteLength(line, 'utf8');
    if (lineLen <= maxBytes) {
      lines.push(line);
    } else {
      const match = line.match(/^([a-zA-Z0-9]+):\s*(.*)/);
      const aliasPrefix = match ? `${match[1]}: ` : '';
      const body = match ? match[2] : line;
      lines.push(...splitTextBySentences(body, aliasPrefix, maxBytes));
    }
  }

  const sections = [];
  let currentGroup = [];
  let currentLength = 0;

  for (const line of lines) {
    const lineLen = Buffer.byteLength(line, 'utf8');
    if (currentLength + lineLen + 1 > maxBytes && currentGroup.length > 0) {
      sections.push(currentGroup.join('\n'));
      currentGroup = [line];
      currentLength = lineLen;
    } else {
      currentGroup.push(line);
      currentLength += lineLen + 1;
    }
  }

  if (currentGroup.length > 0) {
    sections.push(currentGroup.join('\n'));
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
