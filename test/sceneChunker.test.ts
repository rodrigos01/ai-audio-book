import { describe, expect, it } from "vitest";
import { chunkSceneScript } from "../src/services/chapterGeneration/sceneChunker";

const MAX_TTS_INPUT_TOKENS = 12_000;

function turn(speaker: string, chars: number): string {
  return `[${speaker}]: ${"a".repeat(chars)}`;
}

describe("chunkSceneScript", () => {
  it("combines multiple small turns from up to 2 speakers into one chunk when well under budget", () => {
    const script = [turn("A", 40), turn("B", 40), turn("A", 40)].join("\n\n");
    const chunks = chunkSceneScript(script, 0);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.startOffset).toBe(0);
    expect(chunks[0]?.endOffset).toBe(script.length);
    expect(new Set(chunks[0]?.speakerNames)).toEqual(new Set(["A", "B"]));
  });

  it("forces a break the instant a 3rd distinct voice would be introduced, even under budget", () => {
    const script = [turn("A", 20), turn("B", 20), turn("C", 20)].join("\n\n");
    const chunks = chunkSceneScript(script, 0);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.speakerNames.sort()).toEqual(["A", "B"]);
    expect(chunks[1]?.speakerNames).toEqual(["C"]);
    // In order, non-overlapping (a "\n\n" separator may fall in the gap
    // between two chunks, same as the podcast chunker between turns).
    expect(chunks[0]?.startOffset).toBe(0);
    expect(chunks[1]!.startOffset).toBeGreaterThanOrEqual(chunks[0]!.endOffset);
    expect(chunks[1]?.endOffset).toBe(script.length);
    for (const chunk of chunks) {
      expect(chunk.speakerNames.length).toBeLessThanOrEqual(2);
    }
  });

  it("keeps forcing breaks across many alternating voices, never exceeding 2 per chunk", () => {
    const speakers = ["A", "B", "C", "D", "E"];
    const script = speakers.map((speaker) => turn(speaker, 10)).join("\n\n");
    const chunks = chunkSceneScript(script, 0);

    for (const chunk of chunks) {
      expect(chunk.speakerNames.length).toBeLessThanOrEqual(2);
    }
    // Every speaker still appears somewhere in the output.
    const allSpeakers = new Set(chunks.flatMap((chunk) => chunk.speakerNames));
    expect(allSpeakers).toEqual(new Set(speakers));
  });

  it("never splits a turn across two chunks", () => {
    const basePromptTokens = MAX_TTS_INPUT_TOKENS - 100;
    const turns = [turn("A", 300), turn("B", 300), turn("A", 300)];
    const script = turns.join("\n\n");
    const chunks = chunkSceneScript(script, basePromptTokens);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const slice = script.slice(chunk.startOffset, chunk.endOffset);
      expect(slice.startsWith("[A]:") || slice.startsWith("[B]:")).toBe(true);
    }
  });

  it("respects the token budget net of the base prompt's token cost", () => {
    const basePromptTokens = MAX_TTS_INPUT_TOKENS - 100;
    const script = [turn("A", 300), turn("B", 300)].join("\n\n");
    const chunks = chunkSceneScript(script, basePromptTokens);
    for (const chunk of chunks) {
      expect(chunk.estimatedTokens).toBeLessThanOrEqual(100);
    }
  });

  it("falls back to sentence-level splitting for a single oversized turn", () => {
    const basePromptTokens = MAX_TTS_INPUT_TOKENS - 100; // budget ~400 chars
    const longSentence = "This is a sentence that repeats. ".repeat(40);
    const script = `[A]: ${longSentence}`;
    const chunks = chunkSceneScript(script, basePromptTokens);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.speakerNames).toEqual(["A"]);
    }

    const firstSlice = script.slice(chunks[0]?.startOffset, chunks[0]?.endOffset);
    expect(firstSlice.startsWith("[A]:")).toBe(true);

    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]?.startOffset).toBe(chunks[i - 1]?.endOffset);
    }
    expect(chunks[0]?.startOffset).toBe(0);
    expect(chunks[chunks.length - 1]?.endOffset).toBe(script.length);

    const rebuilt = chunks.map((c) => script.slice(c.startOffset, c.endOffset)).join("");
    expect(rebuilt).toBe(script);
  });
});
