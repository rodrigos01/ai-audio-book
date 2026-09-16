import { generateText } from "../llm/geminiClient";
import {
  buildChapterAnalysisPrompt,
  chapterAnalysisSystemInstruction,
} from "../llm/prompts/chapterWizard.prompts";
import {
  chapterAnalysisResponseSchema,
  chapterDraftSchema,
  type ChapterAnalysisResponse,
  type ChapterDraft,
  type CharacterDraft,
} from "../schemas/chapterDraft.schema";
import type { Person, PersonInput } from "../schemas/person.schema";
import type { Source } from "../schemas/source.schema";

/**
 * Matches the director's detected characters against a Title's existing
 * Cast by name: an existing match comes back with its existing persona and
 * voice (and id, so confirm can preserve it) — never the LLM's suggestion
 * for that character — while a genuinely new character keeps the LLM's
 * suggested persona/voice. See "Title Cast" in audiobook-specs.md.
 */
export function crossReferenceCharacters(
  existingCast: Person[],
  detected: PersonInput[],
): CharacterDraft[] {
  return detected.map((character) => {
    const existing = existingCast.find(
      (member) => member.name.trim().toLowerCase() === character.name.trim().toLowerCase(),
    );
    return existing
      ? { id: existing.id, name: existing.name, voice: existing.voice, persona: existing.persona }
      : { name: character.name, voice: character.voice, persona: character.persona };
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds `excerpt` in `sourceText` at or after `fromIndex`. Tries an exact
 * substring match first; if that fails (e.g. the model normalized some
 * whitespace while copying), falls back to a whitespace-tolerant match on
 * the excerpt's words.
 */
function findExcerpt(sourceText: string, excerpt: string, fromIndex: number): number {
  const exact = sourceText.indexOf(excerpt, fromIndex);
  if (exact !== -1) return exact;

  const words = excerpt.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return -1;
  const pattern = new RegExp(words.map(escapeRegExp).join("\\s+"));
  const match = pattern.exec(sourceText.slice(fromIndex));
  return match ? fromIndex + match.index : -1;
}

/**
 * Resolves each scene's LLM-provided verbatim excerpt to an exact
 * {start, end} span within the chapter's real source text — never trusting
 * the LLM to compute character offsets itself. Spans are snapped so they're
 * contiguous and cover the source edge to edge (a scene's end is simply the
 * next scene's resolved start, and the last scene always runs to the end of
 * the source), so no text is silently dropped between scenes even if an
 * excerpt's exact boundary is a few characters off.
 */
export function resolveSceneSpans(
  sourceText: string,
  excerpts: string[],
): { start: number; end: number }[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const excerpt of excerpts) {
    const start = findExcerpt(sourceText, excerpt, cursor);
    if (start === -1) {
      throw new Error(
        `Could not locate a generated scene's source text within the chapter (starts: "${excerpt.slice(0, 60)}")`,
      );
    }
    starts.push(start);
    cursor = start + excerpt.length;
  }
  return starts.map((start, index) => {
    const nextStart = starts[index + 1];
    return { start, end: nextStart ?? sourceText.length };
  });
}

function toChapterDraft(
  response: ChapterAnalysisResponse,
  source: Source,
  existingCast: Person[],
): ChapterDraft {
  const spans = resolveSceneSpans(
    source.contents,
    response.scenes.map((scene) => scene.sourceExcerpt),
  );
  return chapterDraftSchema.parse({
    name: response.name,
    synopsis: response.synopsis,
    scenes: response.scenes.map((scene, index) => {
      const span = spans[index];
      if (!span) throw new Error(`Missing resolved span for scene ${index}`);
      return {
        name: scene.name,
        description: scene.description,
        directorNotes: scene.directorNotes,
        sampleContext: scene.sampleContext,
        sourceStartOffset: span.start,
        sourceEndOffset: span.end,
      };
    }),
    characters: crossReferenceCharacters(existingCast, response.characters),
  });
}

export async function generateChapterDraft(source: Source, existingCast: Person[]): Promise<ChapterDraft> {
  const response = await generateText({
    systemInstruction: chapterAnalysisSystemInstruction(existingCast),
    prompt: buildChapterAnalysisPrompt(source),
    schema: chapterAnalysisResponseSchema,
  });
  return toChapterDraft(response, source, existingCast);
}
