import { z } from "zod";
import { personInputSchema, personSchema } from "./person.schema";

// No generation step at Title creation — just a name and optional
// description (audiobook-specs.md, "Creating Titles"). Cast starts empty and
// is built up entirely through Chapters.
export const titleCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).optional(),
});

// A cast member keeps its id across an update (passed back by the client) so
// a Chapter's castIds stay valid — same pattern as a podcast host update.
const castUpdateInputSchema = personInputSchema.extend({
  id: z.string().min(1).optional(),
});

export const titleUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  cast: z.array(castUpdateInputSchema).optional(),
});

export const titleSchema = titleCreateSchema.extend({
  id: z.string().min(1),
  cast: z.array(personSchema),
  ownerId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type TitleCreateInput = z.infer<typeof titleCreateSchema>;
export type TitleUpdateInput = z.infer<typeof titleUpdateSchema>;
export type Title = z.infer<typeof titleSchema>;
