import { generateText } from "../llm/geminiClient";
import {
  buildEpisodeDraftPrompt,
  buildEpisodeRevisePrompt,
  episodeWizardSystemInstruction,
} from "../llm/prompts/episodeWizard.prompts";
import type { Podcast } from "../schemas/podcast.schema";
import type { Source } from "../schemas/source.schema";
import { episodeDraftSchema, type EpisodeDraft } from "../schemas/wizard.schema";

export async function generateDraft(
  podcast: Podcast,
  sources: Source[],
  prompt?: string,
): Promise<EpisodeDraft> {
  return generateText({
    systemInstruction: episodeWizardSystemInstruction(podcast),
    prompt: buildEpisodeDraftPrompt(sources, prompt),
    schema: episodeDraftSchema,
  });
}

export async function reviseDraft(
  podcast: Podcast,
  draft: EpisodeDraft,
  instruction: string,
): Promise<EpisodeDraft> {
  return generateText({
    systemInstruction: episodeWizardSystemInstruction(podcast),
    prompt: buildEpisodeRevisePrompt(draft, instruction),
    schema: episodeDraftSchema,
  });
}
