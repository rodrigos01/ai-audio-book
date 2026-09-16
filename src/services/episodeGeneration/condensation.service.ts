import { generateText } from "../../llm/geminiClient";
import {
  buildCondensationPrompt,
  condensationSystemInstruction,
} from "../../llm/prompts/condensation.prompts";
import { condensationSchema } from "../../schemas/condensation.schema";
import type { Person } from "../../schemas/person.schema";

export async function condenseForHost(host: Person, transcript: string): Promise<string> {
  const result = await generateText({
    systemInstruction: condensationSystemInstruction(host.name, host.persona),
    prompt: buildCondensationPrompt(transcript),
    schema: condensationSchema,
  });
  return result.summary;
}

export async function condenseForAllHosts(
  hosts: Person[],
  transcript: string,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    hosts.map(async (host) => [host.id, await condenseForHost(host, transcript)] as const),
  );
  return Object.fromEntries(entries);
}
