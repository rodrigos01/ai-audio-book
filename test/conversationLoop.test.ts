import { describe, expect, it } from "vitest";
import { runConversation, type ConversationAgent } from "../src/services/episodeGeneration/conversationLoop";
import type { Cast, Speaker } from "../src/services/episodeGeneration/speakerSelection";

function speaker(id: string, name: string, isHost: boolean): Speaker {
  return { id, name, voice: "Puck", persona: "p", isHost };
}

function fakeAgent(
  speakerRef: Speaker,
  opts: { wordsPerTurn: number; endEpisodeFrom?: number },
): ConversationAgent {
  let calls = 0;
  const line = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  return {
    name: speakerRef.name,
    isHost: speakerRef.isHost,
    async kickoff() {
      calls++;
      const endEpisode = opts.endEpisodeFrom !== undefined && calls >= opts.endEpisodeFrom;
      return { speech: line(opts.wordsPerTurn), endEpisode };
    },
    async respond() {
      calls++;
      const endEpisode = opts.endEpisodeFrom !== undefined && calls >= opts.endEpisodeFrom;
      return { speech: line(opts.wordsPerTurn), endEpisode };
    },
  };
}

const twoHostCast = (): Cast => {
  const a = speaker("h1", "Host A", true);
  const b = speaker("h2", "Host B", true);
  return { speakers: [a, b], kickoffSpeakerId: "h1" };
};

describe("runConversation stop conditions", () => {
  it("ignores a below-min endEpisode signal and keeps going", async () => {
    const cast = twoHostCast();
    const wordTarget = { min: 100, max: 120 };
    const agents = {
      h1: fakeAgent(cast.speakers[0], { wordsPerTurn: 10, endEpisodeFrom: 1 }),
      h2: fakeAgent(cast.speakers[1], { wordsPerTurn: 10 }),
    };
    const result = await runConversation(cast, agents, wordTarget);
    // h1 signals endEpisode on every one of its turns, starting well below
    // min=100 — those early signals must be ignored, so the conversation
    // keeps running until word count actually reaches min before stopping.
    expect(result.finalWordCount).toBeGreaterThanOrEqual(wordTarget.min);
    expect(result.finalWordCount).toBeLessThan(wordTarget.max);
  });

  it("stops once in-range and a host signals endEpisode", async () => {
    const cast = twoHostCast();
    const wordTarget = { min: 30, max: 200 };
    // 10 words/turn; endEpisode from the agent's 4th call onward (~40 words for that speaker).
    const agents = {
      h1: fakeAgent(cast.speakers[0], { wordsPerTurn: 10, endEpisodeFrom: 4 }),
      h2: fakeAgent(cast.speakers[1], { wordsPerTurn: 10 }),
    };
    const result = await runConversation(cast, agents, wordTarget);
    expect(result.finalWordCount).toBeGreaterThanOrEqual(wordTarget.min);
    expect(result.finalWordCount).toBeLessThan(wordTarget.max);
  });

  it("reaches a realistic word target even when turns are short (regression)", async () => {
    // Short, snappy turns (~10-15 words, like a real interjection-heavy
    // conversation) needing 200+ turns to reach a "short" episode's word
    // target must NOT be cut off by a turn ceiling sized for longer turns.
    const cast = twoHostCast();
    const wordTarget = { min: 3500, max: 5000 };
    const agents = {
      h1: fakeAgent(cast.speakers[0], { wordsPerTurn: 12, endEpisodeFrom: 300 }),
      h2: fakeAgent(cast.speakers[1], { wordsPerTurn: 12 }),
    };
    const result = await runConversation(cast, agents, wordTarget);
    expect(result.finalWordCount).toBeGreaterThanOrEqual(wordTarget.min);
  });

  it("force-stops at/above max even without cooperation", async () => {
    const cast = twoHostCast();
    const wordTarget = { min: 10, max: 50 };
    const agents = {
      h1: fakeAgent(cast.speakers[0], { wordsPerTurn: 10 }),
      h2: fakeAgent(cast.speakers[1], { wordsPerTurn: 10 }),
    };
    const result = await runConversation(cast, agents, wordTarget);
    expect(result.finalWordCount).toBeGreaterThanOrEqual(wordTarget.max);
    expect(result.finalWordCount).toBeLessThan(wordTarget.max * 1.2);
  });

  it("hard safety valve stops a runaway loop that never cooperates", async () => {
    const cast = twoHostCast();
    // max is huge and agents never say endEpisode nor reach it quickly — the
    // turn ceiling scales with wordTarget.max (so short, snappy turns aren't
    // cut off prematurely) but is itself capped at MAX_TURNS_CEILING (1000),
    // which is what should bound this runaway case.
    const wordTarget = { min: 10, max: 1_000_000 };
    const agents = {
      h1: fakeAgent(cast.speakers[0], { wordsPerTurn: 1 }),
      h2: fakeAgent(cast.speakers[1], { wordsPerTurn: 1 }),
    };
    const result = await runConversation(cast, agents, wordTarget);
    expect(result.finalWordCount).toBeLessThan(wordTarget.max);
    expect(result.turns.length).toBeLessThanOrEqual(1000);
  });
});
