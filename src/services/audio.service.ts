import type { Response } from "express";
import { streamSpeech } from "../llm/geminiClient";
import {
  getCachedChunk,
  getCachedChunkSize,
  putCachedChunk,
} from "../storage/audioCache.repository";
import type { Episode, TtsChunk } from "../schemas/episode.schema";
import type { Podcast } from "../schemas/podcast.schema";
import { buildWavHeader, WAV_HEADER_BYTES } from "../utils/wav";
import { HttpError } from "../utils/HttpError";

const SPEAKER_LABEL_RE = /^\[([^\]]+)\]:/;

/**
 * Chunk offsets are pure slices of the transcript (see chunker.ts) — a
 * chunk that's a continuation of an oversized single turn won't itself
 * start with a "[Speaker]:" label, so we look backward for the nearest one.
 */
function getChunkText(transcript: string, chunk: TtsChunk): string {
  const raw = transcript.slice(chunk.startOffset, chunk.endOffset);
  if (SPEAKER_LABEL_RE.test(raw)) return raw;

  const before = transcript.slice(0, chunk.startOffset);
  const matches = [...before.matchAll(/\[[^\]]+\]:/g)];
  const label = matches.at(-1)?.[0] ?? "";
  return label ? `${label} ${raw}` : raw;
}

function resolveCastVoices(
  podcast: Podcast,
  episode: Episode,
): { speaker: string; voiceName: string }[] {
  const hosts = podcast.hosts.filter((h) => episode.participantHostIds.includes(h.id));
  return [...hosts, ...episode.guests].map((p) => ({ speaker: p.name, voiceName: p.voice }));
}

function assertAudioReady(episode: Episode): asserts episode is Episode & {
  ttsChunks: TtsChunk[];
  transcript: string;
  ttsPrompt: string;
} {
  if (episode.status !== "ready" || !episode.ttsChunks || !episode.transcript || !episode.ttsPrompt) {
    throw HttpError.badRequest("Episode audio is not ready yet");
  }
}

/**
 * Concurrent requests hitting the same not-yet-cached chunk (a retried
 * connection, a double-tap on play) must not each independently call the
 * TTS API for it. Only the first ("leader") request actually generates —
 * it drives the shared promise below and gets true low-latency progressive
 * delivery via its onDelta callback. Any concurrent ("follower") request
 * for the same chunk just awaits the same promise and writes the resulting
 * buffer once it resolves, same as a cache hit.
 */
const inFlightGenerations = new Map<string, Promise<Buffer>>();

function chunkKey(podcastId: string, episodeId: string, index: number): string {
  return `${podcastId}:${episodeId}:${index}`;
}

function getOrStartChunkGeneration(
  podcastId: string,
  episodeId: string,
  index: number,
  prompt: string,
  speakers: { speaker: string; voiceName: string }[],
  onDelta: (delta: Buffer) => void,
): { promise: Promise<Buffer>; isLeader: boolean } {
  const key = chunkKey(podcastId, episodeId, index);
  const existing = inFlightGenerations.get(key);
  if (existing) {
    return { promise: existing, isLeader: false };
  }

  const promise = (async () => {
    const parts: Buffer[] = [];
    await streamSpeech(prompt, speakers, (delta) => {
      parts.push(delta);
      onDelta(delta);
    });
    const full = Buffer.concat(parts);
    await putCachedChunk(podcastId, episodeId, index, full);
    return full;
  })();

  inFlightGenerations.set(key, promise);
  promise.finally(() => inFlightGenerations.delete(key));
  return { promise, isLeader: true };
}

/** Writes `data` sliced from `rangeStart` (relative to `chunkStart`), if any of it is in range. */
function writeSlice(res: Response, data: Buffer, chunkStart: number, rangeStart: number): void {
  if (res.destroyed || res.writableEnded) return;
  if (rangeStart < chunkStart + data.length) {
    res.write(data.subarray(Math.max(0, rangeStart - chunkStart)));
  }
}

/**
 * Streams the concatenation of all of an episode's TTS chunks as one
 * continuous WAV resource, generating (and caching) any chunk on demand the
 * first time it's needed. specs.md's Audio Delivery section calls for
 * on-demand, listen-triggered generation streamed back to the client, with
 * scrubbing disallowed until every chunk exists — so:
 *
 * - If every chunk is already cached, we know the total length: serve a
 *   normal, fully seekable static resource (real Content-Length,
 *   Accept-Ranges, honors any Range request).
 * - Otherwise we don't know the final length, so we serve chunked-transfer
 *   (no Content-Length) starting from `rangeStart`, live-generating and
 *   caching whatever chunk(s) that offset falls into or beyond. A `Range`
 *   request into the *already-cached* prefix resumes precisely from there;
 *   one that reaches into ungenerated territory just continues generation
 *   from that chunk's start until enough bytes exist to satisfy it.
 */
export async function streamEpisodeAudio(
  podcastId: string,
  episodeId: string,
  episode: Episode,
  podcast: Podcast,
  res: Response,
  rangeStart: number,
): Promise<void> {
  assertAudioReady(episode);
  const chunks = episode.ttsChunks;
  const speakers = resolveCastVoices(podcast, episode);

  const cachedSizes = await Promise.all(
    chunks.map((_, index) => getCachedChunkSize(podcastId, episodeId, index)),
  );
  const allCached = cachedSizes.every((size) => size !== null);

  res.set("Content-Type", "audio/wav");
  res.set("Accept-Ranges", "bytes");

  if (allCached) {
    const totalPcmBytes = cachedSizes.reduce((sum, size) => sum + (size ?? 0), 0);
    const totalLength = WAV_HEADER_BYTES + totalPcmBytes;

    if (rangeStart >= totalLength) {
      throw new HttpError(416, "Range Not Satisfiable");
    }

    if (rangeStart > 0) {
      res.status(206);
      res.set("Content-Range", `bytes ${rangeStart}-${totalLength - 1}/${totalLength}`);
    } else {
      res.status(200);
    }
    res.set("Content-Length", String(totalLength - rangeStart));

    const header = buildWavHeader(totalPcmBytes);
    res.write(header.subarray(rangeStart));

    let pos = header.length;
    for (let index = 0; index < chunks.length; index++) {
      const data = await getCachedChunk(podcastId, episodeId, index);
      if (data) writeSlice(res, data, pos, rangeStart);
      pos += data?.length ?? 0;
    }
    res.end();
    return;
  }

  res.status(200);
  const header = buildWavHeader(null);
  res.write(header.subarray(Math.min(rangeStart, header.length)));

  let stopped = false;
  res.on("close", () => {
    stopped = true;
  });

  let pos = header.length;
  for (let index = 0; index < chunks.length && !stopped; index++) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const chunkStart = pos;
    const cachedSize = cachedSizes[index];

    if (cachedSize !== null) {
      const data = await getCachedChunk(podcastId, episodeId, index);
      if (data) writeSlice(res, data, chunkStart, rangeStart);
      pos = chunkStart + (data?.length ?? 0);
      continue;
    }

    const chunkText = getChunkText(episode.transcript, chunk);
    const fullPrompt = `${episode.ttsPrompt}\n\n#### TRANSCRIPT\n${chunkText}`;

    let emittedInChunk = 0;
    const { promise, isLeader } = getOrStartChunkGeneration(
      podcastId,
      episodeId,
      index,
      fullPrompt,
      speakers,
      (delta) => {
        writeSlice(res, delta, chunkStart + emittedInChunk, rangeStart);
        emittedInChunk += delta.length;
      },
    );

    if (isLeader) {
      // Progressive delivery already happened via the onDelta callback above.
      const fullChunk = await promise;
      pos = chunkStart + fullChunk.length;
    } else {
      // Follower: no progressive delivery occurred for us — write once, in full, when ready.
      const fullChunk = await promise;
      writeSlice(res, fullChunk, chunkStart, rangeStart);
      pos = chunkStart + fullChunk.length;
    }
  }

  if (!res.destroyed && !res.writableEnded) res.end();
}
