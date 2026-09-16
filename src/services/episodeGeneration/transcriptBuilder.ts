export interface TranscriptTurn {
  speakerName: string;
  text: string;
}

export function buildTranscript(turns: TranscriptTurn[]): string {
  return turns.map((turn) => `${turn.speakerName}: ${turn.text.trim()}`).join("\n\n");
}
