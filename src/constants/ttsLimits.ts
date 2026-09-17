// Conservative ceiling for a single TTS submission (base prompt + chunk
// text combined), safely under Gemini TTS's stated "tens of thousands of
// tokens" context window per prompting-guide.md.
export const MAX_TTS_INPUT_TOKENS = 12_000;

// specs.md's "Audio Generation" section calls for audio to be generated
// on-demand and streamed back *as the user listens* — chunking purely up
// to MAX_TTS_INPUT_TOKENS would pack an entire short episode (or scene) into
// one TTS call, so the client waits for all of it to synthesize before
// playback can start. Target a much smaller practical chunk size (~4
// minutes of speech) instead, so the first chunk is ready quickly. Shared
// by both the Podcast episode chunker and the audiobook scene chunker.
export const TARGET_CHUNK_TOKENS = 1_000;
