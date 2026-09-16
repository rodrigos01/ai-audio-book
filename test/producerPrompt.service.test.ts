import { describe, expect, it } from "vitest";
import { renderProducerPrompt } from "../src/services/episodeGeneration/producerPrompt.service";
import type { ProducerPromptDraft } from "../src/schemas/producerPrompt.schema";

describe("renderProducerPrompt", () => {
  it("renders a stable, deterministic prompt from a fixed draft", () => {
    const draft: ProducerPromptDraft = {
      scene: "A rain-soaked broadcast booth at 2 AM.",
      speakerProfiles: [
        { name: "Marcus", archetype: "Night-owl engineer", style: "Warm, low", pacing: "Slow", accent: "General American" },
        { name: "Priya", archetype: "Curious hacker", style: "Bright, quick", pacing: "Brisk", accent: "General American" },
      ],
      sampleContext: "A late-night tech podcast.",
    };

    expect(renderProducerPrompt(draft)).toBe(
      [
        "# THE SCENE",
        "A rain-soaked broadcast booth at 2 AM.",
        "",
        '## AUDIO PROFILE: Marcus\n"Night-owl engineer"',
        "",
        "### DIRECTOR'S NOTES for Marcus\nStyle: Warm, low\nPacing: Slow\nAccent: General American",
        "",
        '## AUDIO PROFILE: Priya\n"Curious hacker"',
        "",
        "### DIRECTOR'S NOTES for Priya\nStyle: Bright, quick\nPacing: Brisk\nAccent: General American",
        "",
        "### SAMPLE CONTEXT",
        "A late-night tech podcast.",
      ].join("\n"),
    );
  });
});
