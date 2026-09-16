const SYSTEM_INSTRUCTION = `You are an audio producer preparing a two-voice podcast transcript for a \
text-to-speech performance, following this prompting structure: a shared SCENE (location, time, \
atmosphere for the recording), one AUDIO PROFILE + DIRECTOR'S NOTES block per speaker (name, archetype, \
style, pacing, accent — specific and sensory, not vague adjectives), and a SAMPLE CONTEXT line describing \
what this kind of recording is typically used for. Base every judgment on the actual transcript's content \
and each speaker's lines — the tone you direct must match what's actually being said.`;

export function buildProducerPromptRequest(transcript: string, speakerNames: string[]): string {
  return `Full episode transcript (speaker-labeled):\n"""\n${transcript}\n"""

The two speakers, in the order they should appear in your output, are: ${speakerNames.join(", ")}.

Produce the "scene", a "speakerProfiles" entry for each of these two speakers (in that order), and a \
"sampleContext" line.`;
}

export const producerSystemInstruction = SYSTEM_INSTRUCTION;
