import { z } from "zod";

const speakerProfileSchema = z.object({
  name: z.string().min(1),
  archetype: z.string().min(1),
  style: z.string().min(1),
  pacing: z.string().min(1),
  accent: z.string().min(1),
});

export const producerPromptDraftSchema = z.object({
  scene: z.string().min(1),
  speakerProfiles: z.array(speakerProfileSchema).length(2),
  sampleContext: z.string().min(1),
});

export type ProducerPromptDraft = z.infer<typeof producerPromptDraftSchema>;
export type SpeakerProfile = z.infer<typeof speakerProfileSchema>;
