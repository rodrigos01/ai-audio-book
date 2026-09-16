import { generateText } from "../llm/geminiClient";
import {
  buildOptionsPrompt,
  buildReviseAllPrompt,
  buildReviseSinglePrompt,
  podcastWizardSystemInstruction,
} from "../llm/prompts/podcastWizard.prompts";
import {
  podcastOptionSchema,
  podcastOptionsResponseSchema,
  type PodcastOption,
} from "../schemas/wizard.schema";
import { z } from "zod";

export async function generateOptions(
  prompt: string,
  sourceMaterial?: string,
): Promise<PodcastOption[]> {
  const result = await generateText({
    systemInstruction: podcastWizardSystemInstruction,
    prompt: buildOptionsPrompt(prompt, sourceMaterial),
    schema: podcastOptionsResponseSchema,
  });
  return result.options;
}

const singleOptionResponseSchema = z.object({ option: podcastOptionSchema });

export async function reviseOptions(
  options: PodcastOption[],
  instruction: string,
  targetIndex?: number,
): Promise<PodcastOption[]> {
  if (targetIndex !== undefined) {
    const result = await generateText({
      systemInstruction: podcastWizardSystemInstruction,
      prompt: buildReviseSinglePrompt(options[targetIndex], instruction),
      schema: singleOptionResponseSchema,
    });
    const updated = [...options];
    updated[targetIndex] = result.option;
    return updated;
  }

  const result = await generateText({
    systemInstruction: podcastWizardSystemInstruction,
    prompt: buildReviseAllPrompt(options, instruction),
    schema: podcastOptionsResponseSchema,
  });
  return result.options;
}
