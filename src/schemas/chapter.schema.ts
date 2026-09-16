import { z } from "zod";
import { chapterDraftSchema } from "./chapterDraft.schema";

// Confirm sends back the (possibly user-edited) draft plus the sourceId it
// was analyzed from — the stateless-wizard pattern, nothing persisted until
// this call.
export const chapterConfirmSchema = z.object({
  sourceId: z.string().min(1),
  draft: chapterDraftSchema,
});

export const chapterProgressSchema = z.object({
  currentSceneIndex: z.number().int().nonnegative(),
  totalScenes: z.number().int().nonnegative(),
});

export const chapterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  synopsis: z.string().min(1),
  sourceId: z.string().min(1),
  castIds: z.array(z.string().min(1)),
  status: z.enum(["generating", "ready", "failed"]),
  progress: chapterProgressSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ChapterConfirmInput = z.infer<typeof chapterConfirmSchema>;
export type ChapterProgress = z.infer<typeof chapterProgressSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
