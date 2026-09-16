import { z } from "zod";
import { voiceIdSchema } from "./common.schema";

export const personInputSchema = z.object({
  name: z.string().min(1),
  voice: voiceIdSchema,
  persona: z.string().min(1),
});

export const personSchema = personInputSchema.extend({
  id: z.string().min(1),
});

export type PersonInput = z.infer<typeof personInputSchema>;
export type Person = z.infer<typeof personSchema>;
