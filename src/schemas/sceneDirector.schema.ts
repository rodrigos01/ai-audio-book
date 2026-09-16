import { z } from "zod";

export const directorScriptResponseSchema = z.object({
  script: z.string().min(1),
});

export type DirectorScriptResponse = z.infer<typeof directorScriptResponseSchema>;
