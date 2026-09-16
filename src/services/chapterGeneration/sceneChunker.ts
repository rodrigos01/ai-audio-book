import { MAX_TTS_INPUT_TOKENS, TARGET_CHUNK_TOKENS } from "../../constants/ttsLimits";
import { estimateTokens } from "../../utils/tokenEstimate";
import type { SceneTtsChunk } from "../../schemas/scene.schema";

const SPEAKER_LABEL_RE = /^\[([^\]]+)\]:/;

interface TurnSpan {
  text: string;
  startOffset: number;
  endOffset: number;
  speaker: string | null;
}

function splitIntoTurnSpans(script: string): TurnSpan[] {
  const spans: TurnSpan[] = [];
  let cursor = 0;
  // Turns are separated by the blank line the director's script uses, same
  // convention as the podcast side's transcriptBuilder.ts.
  for (const part of script.split("\n\n")) {
    const speaker = part.match(SPEAKER_LABEL_RE)?.[1] ?? null;
    spans.push({ text: part, startOffset: cursor, endOffset: cursor + part.length, speaker });
    cursor += part.length + 2; // account for the "\n\n" separator
  }
  return spans;
}

// Same sentence-level fallback as the podcast chunker's splitOversizedTurn,
// for a single turn that alone exceeds the per-chunk budget. Only the first
// resulting sub-chunk carries the "[Speaker]:" label; a consumer re-adds it
// for later sub-chunks by scanning backward (see audio.service.ts's
// getChunkText). Every sub-chunk belongs to the same one speaker as the
// original turn, so voice tracking below is unaffected by this split.
function splitOversizedTurn(span: TurnSpan, budgetTokens: number): TurnSpan[] {
  const speakerMatch = span.text.match(/^(\[[^\]]+\]:\s*)/);
  const labelChars = speakerMatch?.[1] ? speakerMatch[1].length : 0;
  const sentences = span.text.match(/[^.!?]+[.!?]*\s*/g) ?? [span.text];
  const maxBufferChars = Math.max(1, budgetTokens * 4 - labelChars);

  const parts: TurnSpan[] = [];
  let cursor = span.startOffset;
  let buffer = "";
  for (const sentence of sentences) {
    if (buffer.length > 0 && buffer.length + sentence.length > maxBufferChars) {
      parts.push({
        text: buffer,
        startOffset: cursor,
        endOffset: cursor + buffer.length,
        speaker: span.speaker,
      });
      cursor += buffer.length;
      buffer = "";
    }
    buffer += sentence;
  }
  if (buffer.length > 0 || parts.length === 0) {
    parts.push({ text: buffer, startOffset: cursor, endOffset: cursor + buffer.length, speaker: span.speaker });
  }
  return parts;
}

/**
 * Chunks one scene's speaker-tagged script for TTS submission. Reuses the
 * podcast episode chunker's token-budget / never-split-a-turn / oversized-
 * turn sentence-fallback logic, plus a constraint a podcast episode never
 * needs: a scene can have 3+ speaking characters (unlike an episode's fixed
 * 2), so this tracks the distinct speakers already active in the chunk
 * being built and forces a break the instant a 3rd distinct voice would be
 * introduced, even if the token budget isn't exhausted yet. Always called
 * once per scene — chunks never merge across a scene boundary, since the
 * caller only ever passes one scene's own script text.
 */
export function chunkSceneScript(script: string, basePromptTokens: number): SceneTtsChunk[] {
  const hardCeiling = MAX_TTS_INPUT_TOKENS - basePromptTokens;
  if (hardCeiling <= 0) {
    throw new Error("Base TTS prompt alone exceeds the token budget");
  }
  const budget = Math.min(hardCeiling, TARGET_CHUNK_TOKENS);

  const turnSpans = splitIntoTurnSpans(script);
  const chunks: SceneTtsChunk[] = [];
  let currentText = "";
  let currentStart: number | null = null;
  let currentEnd = 0;
  let activeSpeakers = new Set<string>();

  function flush() {
    if (currentStart === null || currentText.trim().length === 0) return;
    chunks.push({
      index: chunks.length,
      startOffset: currentStart,
      endOffset: currentEnd,
      estimatedTokens: estimateTokens(currentText),
      speakerNames: [...activeSpeakers],
    });
    currentText = "";
    currentStart = null;
    activeSpeakers = new Set();
  }

  function startNewChunk(span: TurnSpan) {
    currentText = span.text;
    currentStart = span.startOffset;
    currentEnd = span.endOffset;
    if (span.speaker) activeSpeakers.add(span.speaker);
  }

  for (const span of turnSpans) {
    const spanTokens = estimateTokens(span.text);

    if (spanTokens > budget) {
      // A single turn alone busts the budget — flush what we have, then
      // emit sentence-level sub-chunks for this turn on their own.
      flush();
      for (const sub of splitOversizedTurn(span, budget)) {
        startNewChunk(sub);
        flush();
      }
      continue;
    }

    const introducesNewSpeaker = span.speaker !== null && !activeSpeakers.has(span.speaker);
    const speakerCountAfter = activeSpeakers.size + (introducesNewSpeaker ? 1 : 0);

    if (currentStart !== null && speakerCountAfter > 2) {
      // Adding this turn would bring a 3rd distinct voice into the chunk —
      // force a break now, even though the token budget may not be
      // exhausted yet (audiobook-specs.md's Chunking section).
      flush();
      startNewChunk(span);
      continue;
    }

    const candidateText = currentStart === null ? span.text : `${currentText}\n\n${span.text}`;
    const candidateTokens = estimateTokens(candidateText);

    if (candidateTokens > budget) {
      flush();
      startNewChunk(span);
    } else {
      currentText = candidateText;
      currentStart = currentStart ?? span.startOffset;
      currentEnd = span.endOffset;
      if (span.speaker) activeSpeakers.add(span.speaker);
    }
  }
  flush();

  return chunks;
}
