import { describe, expect, it } from "vitest";
import { secondsToByteOffset, WAV_HEADER_BYTES, buildWavHeader } from "../src/utils/wav";

describe("secondsToByteOffset", () => {
  // 24000 Hz, mono, 16-bit => 2 bytes/sample * 24000 samples/sec = 48000 bytes/sec.
  const BYTE_RATE = 48000;

  it("maps 0 seconds to right after the header", () => {
    expect(secondsToByteOffset(0)).toBe(WAV_HEADER_BYTES);
  });

  it("maps a whole number of seconds using the known byte rate", () => {
    expect(secondsToByteOffset(10)).toBe(WAV_HEADER_BYTES + 10 * BYTE_RATE);
  });

  it("floors to a whole-sample (2-byte) boundary for fractional seconds", () => {
    const offset = secondsToByteOffset(1.500001);
    const dataOffset = offset - WAV_HEADER_BYTES;
    expect(dataOffset % 2).toBe(0);
    expect(dataOffset).toBeLessThanOrEqual(1.500001 * BYTE_RATE);
  });

  it("clamps negative input to the start of the data region", () => {
    expect(secondsToByteOffset(-5)).toBe(WAV_HEADER_BYTES);
  });
});

describe("buildWavHeader", () => {
  it("declares the same PCM format secondsToByteOffset assumes", () => {
    const header = buildWavHeader(1000);
    expect(header.readUInt32LE(24)).toBe(24000); // sample rate
    expect(header.readUInt16LE(22)).toBe(1); // channels
    expect(header.readUInt16LE(34)).toBe(16); // bit depth
  });
});
