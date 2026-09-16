import { generateText } from "../../llm/geminiClient";
import { buildDirectorPrompt, directorSystemInstruction } from "../../llm/prompts/sceneDirector.prompts";
import { directorScriptResponseSchema } from "../../schemas/sceneDirector.schema";
import type { Person } from "../../schemas/person.schema";
import { estimateTokens } from "../../utils/tokenEstimate";

// gemini-3.8-flash's text context window is far larger than the TTS input
// ceiling (ttsLimits.ts) — this is a much looser guard against a single
// scene's source span being unreasonably long for one generation call, not
// a hard API limit. audiobook-specs.md allows "a small deterministic set of
// calls" for an oversized scene; this is that split.
const MAX_DIRECTOR_SPAN_TOKENS = 6_000;

function splitBySentence(text: string, maxTokens: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const parts: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    const candidate = buffer + sentence;
    if (estimateTokens(candidate) > maxTokens && buffer) {
      parts.push(buffer);
      buffer = sentence;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) parts.push(buffer);
  return parts;
}

/**
 * Splits an oversized source span into a small, deterministic set of
 * sub-spans, preferring paragraph boundaries and falling back to sentence
 * boundaries only if a single paragraph alone is still oversized. Returns
 * the whole text unsplit when it's already within budget.
 */
function splitSpanForGeneration(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];

  const paragraphs = text.split(/\n\n+/);
  const parts: string[] = [];
  let buffer = "";
  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (estimateTokens(candidate) > maxTokens && buffer) {
      parts.push(buffer);
      buffer = paragraph;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) parts.push(buffer);

  return parts.flatMap((part) =>
    estimateTokens(part) <= maxTokens ? [part] : splitBySentence(part, maxTokens),
  );
}

async function generateSpanScript(sceneName: string, span: string, cast: Person[]): Promise<string> {
  const response = await generateText({
    systemInstruction: directorSystemInstruction(cast),
    prompt: buildDirectorPrompt(sceneName, span),
    schema: directorScriptResponseSchema,
  });
  return response.script;
}

/**
 * Generates a scene's full speaker-tagged script from its span of the
 * chapter's fixed source text — one LLM call, or a small deterministic set
 * of calls (concatenated in order) if the span is too long for one, per
 * audiobook-specs.md's Audio Script Generation section.
 */
export async function generateSceneScript(
  sceneName: string,
  sourceSpanText: string,
  cast: Person[],
): Promise<string> {
  const spans = splitSpanForGeneration(sourceSpanText, MAX_DIRECTOR_SPAN_TOKENS);
  const scripts: string[] = [];
  for (const span of spans) {
    scripts.push(await generateSpanScript(sceneName, span, cast));
  }
  return scripts.join("\n\n");
}
