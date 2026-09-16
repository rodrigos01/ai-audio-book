import { describe, expect, it } from "vitest";
import { countWords } from "../src/utils/wordCount";

describe("countWords", () => {
  it("counts plain words", () => {
    expect(countWords("the quick brown fox")).toBe(4);
  });

  it("excludes bracketed audio tags", () => {
    expect(countWords("[whispers] the quick [very fast] brown fox")).toBe(4);
  });

  it("handles contractions and punctuation as single words", () => {
    expect(countWords("I don't think that's right, honestly.")).toBe(6);
  });

  it("returns 0 for empty or tag-only input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("[sighs] [pause]")).toBe(0);
  });
});
