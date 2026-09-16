import { describe, expect, it } from "vitest";
import { crossReferenceCharacters, resolveSceneSpans } from "../src/services/chapterWizard.service";
import type { Person } from "../src/schemas/person.schema";

describe("crossReferenceCharacters", () => {
  const existingCast: Person[] = [
    { id: "cast-1", name: "Elena", voice: "Kore", persona: "A weary detective." },
  ];

  it("keeps the existing id/persona/voice for a name match, discarding the LLM's suggestion", () => {
    const result = crossReferenceCharacters(existingCast, [
      { name: "elena", voice: "Puck", persona: "Some new guess" },
    ]);
    expect(result).toEqual([{ id: "cast-1", name: "Elena", voice: "Kore", persona: "A weary detective." }]);
  });

  it("passes through a genuinely new character with no id", () => {
    const result = crossReferenceCharacters(existingCast, [
      { name: "Marcus", voice: "Orus", persona: "A gruff dockworker." },
    ]);
    expect(result).toEqual([{ name: "Marcus", voice: "Orus", persona: "A gruff dockworker." }]);
  });
});

describe("resolveSceneSpans", () => {
  it("resolves contiguous scenes covering the whole source exactly", () => {
    const source = "Once upon a time. Then something happened. The end.";
    const excerptStarts = ["Once upon a time.", "Then something happened.", "The end."].map((excerpt) =>
      source.indexOf(excerpt),
    );
    const spans = resolveSceneSpans(source, ["Once upon a time.", "Then something happened.", "The end."]);

    expect(spans).toHaveLength(3);
    expect(spans[0]).toEqual({ start: excerptStarts[0], end: excerptStarts[1] });
    expect(spans[1]).toEqual({ start: excerptStarts[1], end: excerptStarts[2] });
    expect(spans[2]).toEqual({ start: excerptStarts[2], end: source.length });

    const rebuilt = spans.map((span) => source.slice(span.start, span.end)).join("");
    expect(rebuilt).toBe(source);
  });

  it("tolerates whitespace differences in the excerpt via word-level matching", () => {
    const source = "Line one.\n\nLine   two continues.";
    const spans = resolveSceneSpans(source, ["Line one.", "Line two continues."]);
    expect(spans[1]?.start).toBe(source.indexOf("Line   two"));
    expect(spans[1]?.end).toBe(source.length);
  });

  it("throws when an excerpt cannot be located in the source", () => {
    expect(() => resolveSceneSpans("Actual text.", ["Not in the source at all."])).toThrow();
  });
});
