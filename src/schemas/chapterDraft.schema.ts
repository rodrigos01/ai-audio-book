import { z } from "zod";
import { personInputSchema } from "./person.schema";

// The director's raw single-pass analysis output — internal to
// chapterWizard.service.ts, never returned to a client directly. Each
// scene's `sourceExcerpt` is the exact verbatim slice of the source text it
// covers (never a paraphrase or a summary); the service resolves these to
// real {start, end} offsets against the chapter's actual source text rather
// than trusting the LLM to compute character positions itself.
export const sceneAnalysisSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  directorNotes: z.string().min(1),
  sampleContext: z.string().min(1),
  sourceExcerpt: z.string().min(1),
});

export const chapterAnalysisResponseSchema = z.object({
  name: z.string().min(1),
  synopsis: z.string().min(1),
  scenes: z.array(sceneAnalysisSchema).min(1),
  characters: z.array(personInputSchema),
});

export type SceneAnalysis = z.infer<typeof sceneAnalysisSchema>;
export type ChapterAnalysisResponse = z.infer<typeof chapterAnalysisResponseSchema>;

export const sceneDraftSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  directorNotes: z.string().min(1),
  sampleContext: z.string().min(1),
  // Which slice of the chapter's source text this scene covers. Not a
  // user-facing editable field — it round-trips through the client like the
  // rest of the stateless draft so confirm can hand the generation pipeline
  // exactly the span it analyzed.
  sourceStartOffset: z.number().int().nonnegative(),
  sourceEndOffset: z.number().int().nonnegative(),
});

// An existing Cast member comes back with its id (preserved through confirm,
// like a podcast host); a newly-detected character has none yet.
export const characterDraftSchema = personInputSchema.extend({
  id: z.string().min(1).optional(),
});

export const chapterDraftSchema = z.object({
  name: z.string().min(1),
  synopsis: z.string().min(1),
  scenes: z.array(sceneDraftSchema).min(1),
  characters: z.array(characterDraftSchema),
});

export const chapterDraftRequestSchema = z.object({
  sourceId: z.string().min(1),
});

export type SceneDraft = z.infer<typeof sceneDraftSchema>;
export type CharacterDraft = z.infer<typeof characterDraftSchema>;
export type ChapterDraft = z.infer<typeof chapterDraftSchema>;
export type ChapterDraftRequest = z.infer<typeof chapterDraftRequestSchema>;
