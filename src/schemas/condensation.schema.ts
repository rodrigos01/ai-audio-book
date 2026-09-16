import { z } from "zod";

export const condensationSchema = z.object({
  summary: z.string().min(1),
});
