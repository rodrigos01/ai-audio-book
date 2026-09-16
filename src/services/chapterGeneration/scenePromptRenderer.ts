import { extractSpeakerNames } from "../../utils/scriptText";
import type { Person } from "../../schemas/person.schema";
import type { Scene } from "../../schemas/scene.schema";

function renderAudioProfile(member: Person): string {
  return `## AUDIO PROFILE: ${member.name}\n"${member.persona}"`;
}

/**
 * Deterministically renders a scene's base TTS prompt from its already-known
 * fields (no LLM call — unlike the Podcast producer, which drafts each
 * speaker's style/pacing/accent itself): the Scene/Director's Notes/Sample
 * Context blocks the analysis pass produced, plus one Audio Profile block
 * per character who actually speaks in the generated script, in the order
 * they first appear. Follows prompting-guide.md's block template, extended
 * to however many characters a scene actually needs (never a fixed 2, since
 * a scene isn't limited to 2 speakers the way a podcast episode is).
 */
export function renderScenePrompt(scene: Scene, script: string, cast: Person[]): string {
  const speakerNames = extractSpeakerNames(script);
  if (speakerNames.length === 0) {
    throw new Error(`Scene "${scene.name}" has no recognizable speakers in its script`);
  }

  const profileBlocks = speakerNames
    .map((name) => {
      const member = cast.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
      if (!member) {
        throw new Error(`Scene "${scene.name}" script references unknown speaker "${name}"`);
      }
      return renderAudioProfile(member);
    })
    .join("\n\n");

  return `# THE SCENE: ${scene.name}\n${scene.description}\n\n### DIRECTOR'S NOTES\n${scene.directorNotes}\n\n### SAMPLE CONTEXT\n${scene.sampleContext}\n\n${profileBlocks}`;
}
