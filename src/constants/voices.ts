export interface Voice {
  id: string;
  gender: "Male" | "Female";
  trait: string;
}

// Source: voice-reference.md — the 30 prebuilt Gemini TTS voices.
export const VOICES: readonly Voice[] = [
  { id: "Achernar", gender: "Female", trait: "Soft" },
  { id: "Achird", gender: "Male", trait: "Friendly" },
  { id: "Algenib", gender: "Male", trait: "Gravelly" },
  { id: "Algieba", gender: "Male", trait: "Smooth" },
  { id: "Alnilam", gender: "Male", trait: "Firm" },
  { id: "Aoede", gender: "Female", trait: "Breezy" },
  { id: "Autonoe", gender: "Female", trait: "Bright" },
  { id: "Callirrhoe", gender: "Female", trait: "Easy-going" },
  { id: "Charon", gender: "Male", trait: "Informative" },
  { id: "Despina", gender: "Female", trait: "Smooth" },
  { id: "Enceladus", gender: "Male", trait: "Breathy" },
  { id: "Erinome", gender: "Female", trait: "Clear" },
  { id: "Fenrir", gender: "Male", trait: "Excitable" },
  { id: "Gacrux", gender: "Female", trait: "Mature" },
  { id: "Iapetus", gender: "Male", trait: "Clear" },
  { id: "Kore", gender: "Female", trait: "Firm" },
  { id: "Laomedeia", gender: "Female", trait: "Upbeat" },
  { id: "Leda", gender: "Female", trait: "Youthful" },
  { id: "Orus", gender: "Male", trait: "Firm" },
  { id: "Puck", gender: "Male", trait: "Upbeat" },
  { id: "Pulcherrima", gender: "Female", trait: "Forward" },
  { id: "Rasalgethi", gender: "Male", trait: "Informative" },
  { id: "Sadachbia", gender: "Male", trait: "Lively" },
  { id: "Sadaltager", gender: "Male", trait: "Knowledgeable" },
  { id: "Schedar", gender: "Male", trait: "Even" },
  { id: "Sulafat", gender: "Female", trait: "Warm" },
  { id: "Umbriel", gender: "Male", trait: "Easy-going" },
  { id: "Vindemiatrix", gender: "Female", trait: "Gentle" },
  { id: "Zephyr", gender: "Female", trait: "Bright" },
  { id: "Zubenelgenubi", gender: "Male", trait: "Casual" },
] as const;

export const VOICE_IDS = VOICES.map((v) => v.id) as [string, ...string[]];
