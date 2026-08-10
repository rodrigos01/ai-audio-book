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

function extractSpeakerTurns(scriptText) {
  if (!scriptText) return [];
  let clean = scriptText.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/```[a-z]*\s*/gi, '').replace(/```/gi, '').trim();
  clean = clean.replace(/^"+|"+$/g, '').trim();

  const normalized = clean.replace(/([^\n])\b([a-zA-Z0-9]+:)/g, '$1\n$2');
  const rawLines = normalized.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  const turns = [];
  for (const line of rawLines) {
    const match = line.match(/^([a-zA-Z0-9]+):\s*(.*)/);
    if (match) {
      let dialogue = match[2].trim().replace(/^["']+|["']+$/g, '').trim();
      turns.push({
        alias: match[1],
        text: dialogue,
        fullTurn: `${match[1]}: ${dialogue}`
      });
    } else {
      turns.push({
        alias: 'Narrator',
        text: line,
        fullTurn: line.startsWith('Narrator:') ? line : `Narrator: ${line}`
      });
    }
  }
  return turns;
}

function splitMultiSpeakerIntoSections(scriptText, maxBytes = 600, maxSpeakers = 2) {
  if (!scriptText) return [];
  const turns = extractSpeakerTurns(scriptText);
  const sections = [];

  let currentGroup = [];
  let currentSpeakers = new Set();
  let currentLength = 0;

  for (const turn of turns) {
    const turnLen = Buffer.byteLength(turn.fullTurn, 'utf8');

    if (turnLen <= maxBytes) {
      const nextSpeakers = new Set(currentSpeakers);
      nextSpeakers.add(turn.alias);

      const exceedsSpeakers = nextSpeakers.size > maxSpeakers;
      const exceedsBytes = currentLength + turnLen + 1 > maxBytes;

      if ((exceedsSpeakers || exceedsBytes) && currentGroup.length > 0) {
        sections.push(currentGroup.join('\n'));
        currentGroup = [turn.fullTurn];
        currentSpeakers = new Set([turn.alias]);
        currentLength = turnLen;
      } else {
        currentGroup.push(turn.fullTurn);
        currentSpeakers.add(turn.alias);
        currentLength += (currentLength ? 1 : 0) + turnLen;
      }
    } else {
      const sentences = turn.text.split(/(?<=[.!?])\s+/);
      const prefix = `${turn.alias}: `;
      let currentSub = '';

      for (const s of sentences) {
        const candidate = currentSub ? `${currentSub} ${s}` : s;
        if (Buffer.byteLength(`${prefix}${candidate}`, 'utf8') > maxBytes && currentSub.length > 0) {
          const chunk = `${prefix}${currentSub.trim()}`;
          if (currentGroup.length > 0) {
            sections.push(currentGroup.join('\n'));
            currentGroup = [];
            currentSpeakers = new Set();
            currentLength = 0;
          }
          sections.push(chunk);
          currentSub = s;
        } else {
          currentSub = candidate;
        }
      }
      if (currentSub) {
        const chunk = `${prefix}${currentSub.trim()}`;
        const chunkLen = Buffer.byteLength(chunk, 'utf8');
        const nextSpeakers = new Set(currentSpeakers);
        nextSpeakers.add(turn.alias);

        if ((nextSpeakers.size > maxSpeakers || currentLength + chunkLen + 1 > maxBytes) && currentGroup.length > 0) {
          sections.push(currentGroup.join('\n'));
          currentGroup = [chunk];
          currentSpeakers = new Set([turn.alias]);
          currentLength = chunkLen;
        } else {
          currentGroup.push(chunk);
          currentSpeakers.add(turn.alias);
          currentLength += (currentLength ? 1 : 0) + chunkLen;
        }
      }
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
