import { describe, expect, it } from "vitest";
import { renderScenePrompt } from "../src/services/chapterGeneration/scenePromptRenderer";
import type { Person } from "../src/schemas/person.schema";
import type { Scene } from "../src/schemas/scene.schema";

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: "scene-1",
    index: 0,
    name: "The Docks at Midnight",
    description: "A fog-covered pier, waves against the pilings.",
    directorNotes: "Tense, hushed — everyone is trying not to be heard.",
    sampleContext: "A noir mystery audiobook chapter.",
    sourceStartOffset: 0,
    sourceEndOffset: 100,
    script: null,
    ttsPrompt: null,
    ttsChunks: null,
    status: "pending",
    error: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const cast: Person[] = [
  { id: "cast-1", name: "Elena", voice: "Kore", persona: "A weary detective." },
  { id: "cast-2", name: "Narrator", voice: "Charon", persona: "A calm, observant storyteller." },
];

describe("renderScenePrompt", () => {
  it("renders a stable, deterministic prompt with one Audio Profile block per speaking character", () => {
    const scene = makeScene();
    const script = "[Narrator]: The pier was empty.\n\n[Elena]: \"Someone's out there,\" she whispered.";

    expect(renderScenePrompt(scene, script, cast)).toBe(
      [
        "# THE SCENE: The Docks at Midnight",
        "A fog-covered pier, waves against the pilings.",
        "",
        "### DIRECTOR'S NOTES",
        "Tense, hushed — everyone is trying not to be heard.",
        "",
        "### SAMPLE CONTEXT",
        "A noir mystery audiobook chapter.",
        "",
        '## AUDIO PROFILE: Narrator\n"A calm, observant storyteller."',
        "",
        '## AUDIO PROFILE: Elena\n"A weary detective."',
      ].join("\n"),
    );
  });

  it("supports more than 2 speaking characters in one scene", () => {
    const threeCast: Person[] = [
      ...cast,
      { id: "cast-3", name: "Marcus", voice: "Orus", persona: "A gruff dockworker." },
    ];
    const script = "[Narrator]: Three figures met at the edge of the pier.\n\n[Elena]: \"Talk.\"\n\n[Marcus]: \"Not here.\"";
    const rendered = renderScenePrompt(makeScene(), script, threeCast);

    expect(rendered).toContain("## AUDIO PROFILE: Narrator");
    expect(rendered).toContain("## AUDIO PROFILE: Elena");
    expect(rendered).toContain("## AUDIO PROFILE: Marcus");
  });

  it("throws if the script references a speaker not in the cast", () => {
    const script = "[Stranger]: Who's there?";
    expect(() => renderScenePrompt(makeScene(), script, cast)).toThrow(/unknown speaker/);
  });

  it("throws if the script has no recognizable speaker labels", () => {
    expect(() => renderScenePrompt(makeScene(), "Just plain text.", cast)).toThrow(/no recognizable speakers/);
  });
});
