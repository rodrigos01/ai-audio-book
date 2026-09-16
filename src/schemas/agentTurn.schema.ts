import { z } from "zod";

export const agentTurnSchema = z.object({
  speech: z.string().min(1),
  endEpisode: z.boolean(),
});

export type AgentTurn = z.infer<typeof agentTurnSchema>;
