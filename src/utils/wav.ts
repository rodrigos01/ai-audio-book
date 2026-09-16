// Gemini TTS returns raw 16-bit PCM (audio/l16) with no container — wrap it
// in a minimal 44-byte RIFF/WAVE header so it's playable.
//
// `dataLength: null` writes the classic "streaming/unknown length" WAV
// convention: 0xFFFFFFFF in the RIFF and data chunk size fields. This is
// what lets us start playback before the whole episode's audio has been
// generated — mainstream browsers and native mobile players tolerate it for
// a live/growing WAV stream, though it's not guaranteed to work with every
// strict WAV parser.
const UNKNOWN_LENGTH = 0xffffffff;

export function buildWavHeader(
  dataLength: number | null,
  sampleRate = 24000,
  channels = 1,
  bitDepth = 16,
): Buffer {
  const blockAlign = (channels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  const riffSize = dataLength === null ? UNKNOWN_LENGTH : 36 + dataLength;
  const dataSize = dataLength === null ? UNKNOWN_LENGTH : dataLength;

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(riffSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  return header;
}

export function pcmToWav(pcmData: Buffer, sampleRate = 24000, channels = 1, bitDepth = 16): Buffer {
  return Buffer.concat([buildWavHeader(pcmData.length, sampleRate, channels, bitDepth), pcmData]);
}

export const WAV_HEADER_BYTES = 44;

// The fixed PCM format Gemini TTS returns for this app's voices (confirmed
// empirically — see AGENTS.md). Centralized here so time<->byte-offset
// conversion for the /stream endpoint's `t=` query param doesn't duplicate
// these numbers.
export const PCM_FORMAT = { sampleRate: 24000, channels: 1, bitDepth: 16 } as const;

const BLOCK_ALIGN = (PCM_FORMAT.channels * PCM_FORMAT.bitDepth) / 8;
const BYTE_RATE = PCM_FORMAT.sampleRate * BLOCK_ALIGN;

/**
 * Converts a saved playback position (seconds) into the byte offset a
 * `Range` request would use — so clients can resume by time without
 * needing to know this app's PCM format. Aligned down to a whole sample
 * (`BLOCK_ALIGN`) so a resumed stream never starts mid-sample.
 */
export function secondsToByteOffset(seconds: number): number {
  const dataOffset = Math.floor((seconds * BYTE_RATE) / BLOCK_ALIGN) * BLOCK_ALIGN;
  return WAV_HEADER_BYTES + Math.max(0, dataOffset);
}
