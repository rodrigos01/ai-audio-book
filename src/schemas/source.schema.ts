import { z } from "zod";

export const sourceCreateSchema = z.object({
  title: z.string().min(1),
  contents: z.string().min(1),
});

export const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  contents: z.string().min(1),
  sourceType: z.enum(["text", "pdf"]),
  originalFilename: z.string().optional(),
  createdAt: z.number(),
});

export type SourceCreateInput = z.infer<typeof sourceCreateSchema>;
export type Source = z.infer<typeof sourceSchema>;
