import { countWords } from "../../utils/wordCount";
import { buildTranscript, type TranscriptTurn } from "./transcriptBuilder";
import type { Cast } from "./speakerSelection";

export interface ConversationAgent {
  name: string;
  isHost: boolean;
  kickoff(wordTarget: WordTarget): Promise<{ speech: string; endEpisode: boolean }>;
  respond(
    transcriptSoFar: string,
    currentWordCount: number,
    wordTarget: WordTarget,
  ): Promise<{ speech: string; endEpisode: boolean }>;
}

export interface WordTarget {
  min: number;
  max: number;
}

export interface ConversationResult {
  turns: TranscriptTurn[];
  transcript: string;
  finalWordCount: number;
}

export interface ConversationProgress {
  wordCount: number;
  transcript: string;
}

// Turns are now explicitly encouraged to be short — sometimes just a few
// words (a reaction, an interjection) — so a fixed turn ceiling sized for
// "normal" paragraph-length turns would cut episodes short well before they
// reach their word-count target. Scale the ceiling off the episode's own
// target instead, assuming turns could plausibly average as little as
// MIN_PLAUSIBLE_WORDS_PER_TURN, so this remains a genuine runaway-loop
// safety valve rather than a normal operating constraint.
const MIN_PLAUSIBLE_WORDS_PER_TURN = 10;
const MAX_TURNS_CEILING = 1000;
const HARD_WORD_CEILING_FACTOR = 1.1;

function computeMaxTurns(wordTarget: WordTarget): number {
  return Math.min(MAX_TURNS_CEILING, Math.ceil(wordTarget.max / MIN_PLAUSIBLE_WORDS_PER_TURN));
}

export async function runConversation(
  cast: Cast,
  agentsBySpeakerId: Record<string, ConversationAgent>,
  wordTarget: WordTarget,
  onProgress?: (progress: ConversationProgress) => Promise<void> | void,
): Promise<ConversationResult> {
  const [a, b] = cast.speakers;
  const other = (speakerId: string) => (speakerId === a.id ? b : a);
  const maxTurns = computeMaxTurns(wordTarget);

  const turns: TranscriptTurn[] = [];
  let wordCount = 0;
  const hardCeiling = wordTarget.max * HARD_WORD_CEILING_FACTOR;

  let currentSpeakerId = cast.kickoffSpeakerId;
  let currentAgent = agentsBySpeakerId[currentSpeakerId];
  if (!currentAgent) throw new Error(`No agent registered for kickoff speaker ${currentSpeakerId}`);

  const first = await currentAgent.kickoff(wordTarget);
  turns.push({ speakerName: currentAgent.name, text: first.speech });
  wordCount += countWords(first.speech);
  await onProgress?.({ wordCount, transcript: buildTranscript(turns) });

  let lastWasHost = currentAgent.isHost;
  let lastEndEpisode = first.endEpisode;

  for (let turnIndex = 1; turnIndex < maxTurns; turnIndex++) {
    if (
      lastWasHost &&
      ((lastEndEpisode && wordCount >= wordTarget.min) || wordCount >= wordTarget.max)
    ) {
      break;
    }
    if (wordCount >= hardCeiling) break;

    const nextSpeaker = other(currentSpeakerId);
    currentSpeakerId = nextSpeaker.id;
    currentAgent = agentsBySpeakerId[currentSpeakerId];
    if (!currentAgent) throw new Error(`No agent registered for speaker ${currentSpeakerId}`);

    const transcriptSoFar = buildTranscript(turns);
    const turn = await currentAgent.respond(transcriptSoFar, wordCount, wordTarget);
    turns.push({ speakerName: currentAgent.name, text: turn.speech });
    wordCount += countWords(turn.speech);
    await onProgress?.({ wordCount, transcript: buildTranscript(turns) });

    lastWasHost = currentAgent.isHost;
    lastEndEpisode = turn.endEpisode;
  }

  return { turns, transcript: buildTranscript(turns), finalWordCount: wordCount };
}
