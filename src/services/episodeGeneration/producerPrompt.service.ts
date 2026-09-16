import { generateText } from "../../llm/geminiClient";
import {
  buildProducerPromptRequest,
  producerSystemInstruction,
} from "../../llm/prompts/producerPrompt.prompts";
import {
  producerPromptDraftSchema,
  type ProducerPromptDraft,
  type SpeakerProfile,
} from "../../schemas/producerPrompt.schema";

/**
 * Renders the structured producer draft into the final base TTS prompt text,
 * following prompting-guide.md's block template extended to 2 speakers
 * (the guide's template is written for a single voice). Rendering
 * deterministically from validated fields — rather than trusting raw LLM
 * prose — keeps this step snapshot-testable.
 */
export function renderProducerPrompt(draft: ProducerPromptDraft): string {
  const profileBlocks = draft.speakerProfiles.map(renderSpeakerProfile).join("\n\n");

  return `# THE SCENE\n${draft.scene}\n\n${profileBlocks}\n\n### SAMPLE CONTEXT\n${draft.sampleContext}`;
}

function renderSpeakerProfile(profile: SpeakerProfile): string {
  return `## AUDIO PROFILE: ${profile.name}\n"${profile.archetype}"\n\n### DIRECTOR'S NOTES for ${profile.name}\nStyle: ${profile.style}\nPacing: ${profile.pacing}\nAccent: ${profile.accent}`;
}

export async function generateBaseTtsPrompt(
  transcript: string,
  speakerNames: [string, string],
): Promise<string> {
  const draft = await generateText({
    systemInstruction: producerSystemInstruction,
    prompt: buildProducerPromptRequest(transcript, speakerNames),
    schema: producerPromptDraftSchema,
  });
  return renderProducerPrompt(draft);
}
