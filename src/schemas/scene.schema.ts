import { z } from "zod";

// Same shape as a podcast episode's TtsChunk, plus the distinct speaker
// names active in this chunk (at most 2, per the TTS service's hard limit —
// see sceneChunker.ts) so the audio layer can resolve their voices without
// re-scanning the script.
export const sceneTtsChunkSchema = z.object({
  index: z.number().int().nonnegative(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  speakerNames: z.array(z.string().min(1)).min(1).max(2),
});

export const sceneSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  name: z.string().min(1),
  description: z.string().min(1),
  directorNotes: z.string().min(1),
  sampleContext: z.string().min(1),
  sourceStartOffset: z.number().int().nonnegative(),
  sourceEndOffset: z.number().int().nonnegative(),
  script: z.string().nullable(),
  ttsPrompt: z.string().nullable(),
  ttsChunks: z.array(sceneTtsChunkSchema).nullable(),
  status: z.enum(["pending", "scripted", "ready", "failed"]),
  error: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type SceneTtsChunk = z.infer<typeof sceneTtsChunkSchema>;
export type Scene = z.infer<typeof sceneSchema>;
