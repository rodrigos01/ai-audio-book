import type { GoogleGenAI as GoogleGenAIClient } from "@google/genai" with { "resolution-mode": "import" };
import type { ZodType } from "zod";
import { z } from "zod";
import { env } from "../config/env";

const TEXT_MODEL = "gemini-3.8-flash";
const TTS_MODEL = "gemini-3.1-flash-tts-preview";

let clientPromise: Promise<GoogleGenAIClient> | null = null;

// @google/genai ships ESM-only type declarations shared across its
// import/require conditions, which trips up TS's Node16 module resolution
// for a static `require`. A dynamic import sidesteps that entirely.
function getClient(): Promise<GoogleGenAIClient> {
  if (!clientPromise) {
    clientPromise = import("@google/genai").then(
      ({ GoogleGenAI }) => new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }),
    );
  }
  return clientPromise;
}

/**
 * Gemini's structured-output schema is an OpenAPI-3.0 subset: it rejects
 * unknown keys like `$schema`/`additionalProperties` that zod's JSON Schema
 * export includes. Strip those recursively so the same zod schema can drive
 * both the API's responseSchema and our own re-validation of its output.
 */
function toGeminiSchema(schema: ZodType): unknown {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
  return sanitize(jsonSchema);
}

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(sanitize);
  }
  if (node && typeof node === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$schema" || key === "additionalProperties") continue;
      result[key] = sanitize(value);
    }
    return result;
  }
  return node;
}

interface GenerateTextOptions<T> {
  systemInstruction: string;
  prompt: string;
  schema: ZodType<T>;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
}

export async function generateText<T>(options: GenerateTextOptions<T>): Promise<T> {
  const responseSchema = toGeminiSchema(options.schema);
  const client = await getClient();

  const response = await withRetry(() =>
    client.models.generateContent({
      model: TEXT_MODEL,
      contents: options.prompt,
      config: {
        systemInstruction: options.systemInstruction,
        responseMimeType: "application/json",
        responseSchema,
      },
    }),
  );

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON output: ${text.slice(0, 200)}`);
  }

  return options.schema.parse(parsed);
}

export interface SpeakerVoice {
  speaker: string;
  voiceName: string;
}

/**
 * Streams raw PCM (audio/l16) deltas for `prompt` as they're synthesized,
 * via the Interactions API's `stream: true` mode — genuine incremental TTS
 * streaming, not a one-shot call. `onChunk` is invoked once per delta with
 * its decoded bytes, in order, so callers can pipe straight to an HTTP
 * response while also buffering for caching. Explicitly requesting a
 * container format (wav/mp3/ogg) is rejected by this model — audio/l16 is
 * the only supported output, confirmed empirically against the live API.
 */
export async function streamSpeech(
  prompt: string,
  speakers: SpeakerVoice[],
  onChunk: (chunk: Buffer) => void,
): Promise<void> {
  const client = await getClient();

  const stream = await withRetry(() =>
    client.interactions.create({
      model: TTS_MODEL,
      input: prompt,
      response_format: { type: "audio" },
      generation_config: {
        speech_config: speakers.map((s) => ({ speaker: s.speaker, voice: s.voiceName })),
      },
      stream: true,
    }),
  );

  let receivedAnyAudio = false;
  try {
    for await (const event of stream) {
      if (event.event_type === "error") {
        throw new Error(`Gemini TTS stream error: ${event.error?.message ?? "unknown error"}`);
      }
      if (event.event_type === "step.delta" && event.delta?.type === "audio" && event.delta.data) {
        receivedAnyAudio = true;
        onChunk(Buffer.from(event.delta.data, "base64"));
      }
    }
  } catch (err) {
    // A long-lived stream can drop mid-transfer (e.g. ECONNRESET) — surface
    // this as a normal rejection rather than letting it propagate as
    // whatever shape the underlying transport threw it in.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini TTS stream failed mid-transfer: ${message}`);
  }

  if (!receivedAnyAudio) {
    throw new Error("Gemini TTS stream produced no audio data");
  }
}

export async function countTokens(text: string): Promise<number> {
  const client = await getClient();
  const response = await withRetry(() =>
    client.models.countTokens({ model: TEXT_MODEL, contents: text }),
  );
  return response.totalTokens ?? Math.ceil(text.length / 4);
}
