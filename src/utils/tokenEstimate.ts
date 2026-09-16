// Cheap, synchronous token estimate (~4 chars/token for English text) used
// for chunk-budgeting decisions. Deliberately not a real API call: the
// chunker evaluates this once per transcript turn, and a network round trip
// per turn would be slow and needlessly costly for what's ultimately a
// conservative heuristic anyway (MAX_TTS_INPUT_TOKENS already has headroom).
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
