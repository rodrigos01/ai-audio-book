import type { Response } from "express";
import { listScenesOrdered } from "../data/scene.repository";
import { streamSpeech, type SpeakerVoice } from "../llm/geminiClient";
import type { Chapter } from "../schemas/chapter.schema";
import type { Person } from "../schemas/person.schema";
import type { Scene, SceneTtsChunk } from "../schemas/scene.schema";
import type { Title } from "../schemas/title.schema";
import {
  getCachedChunk,
  getCachedChunkSize,
  putCachedChunk,
} from "../storage/audiobookAudioCache.repository";
import { buildWavHeader, WAV_HEADER_BYTES } from "../utils/wav";
import { HttpError } from "../utils/HttpError";

const SPEAKER_LABEL_RE = /^\[([^\]]+)\]:/;

/**
 * Chunk offsets are pure slices of a scene's own script (see
 * sceneChunker.ts) — a chunk that's a continuation of an oversized single
 * turn won't itself start with a "[Speaker]:" label, so we look backward
 * for the nearest one, same as the Podcast side's getChunkText.
 */
function getChunkText(script: string, chunk: SceneTtsChunk): string {
  const raw = script.slice(chunk.startOffset, chunk.endOffset);
  if (SPEAKER_LABEL_RE.test(raw)) return raw;

  const before = script.slice(0, chunk.startOffset);
  const matches = [...before.matchAll(/\[[^\]]+\]:/g)];
  const label = matches.at(-1)?.[0] ?? "";
  return label ? `${label} ${raw}` : raw;
}

function resolveChunkSpeakers(cast: Person[], chunk: SceneTtsChunk): SpeakerVoice[] {
  return chunk.speakerNames.map((name) => {
    const member = cast.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!member) throw new Error(`Audio chunk references unknown speaker "${name}"`);
    return { speaker: member.name, voiceName: member.voice };
  });
}

interface GlobalChunk {
  sceneId: string;
  scene: Scene;
  chunk: SceneTtsChunk;
  cachedSize: number | null;
}

/**
 * Flattens a chapter's scenes[].ttsChunks[] (already ordered by scene
 * `index`, then chunk `index`) into one logical chunk sequence spanning the
 * whole chapter — a chapter is presented to the listener as one continuous
 * resource, per audiobook-specs.md's Audio Delivery section.
 */
async function buildGlobalChunks(
  titleId: string,
  chapterId: string,
  scenes: Scene[],
): Promise<GlobalChunk[]> {
  const raw: { sceneId: string; scene: Scene; chunk: SceneTtsChunk }[] = [];
  for (const scene of scenes) {
    for (const chunk of scene.ttsChunks ?? []) {
      raw.push({ sceneId: scene.id, scene, chunk });
    }
  }
  const cachedSizes = await Promise.all(
    raw.map((item) => getCachedChunkSize(titleId, chapterId, item.sceneId, item.chunk.index)),
  );
  return raw.map((item, index) => ({ ...item, cachedSize: cachedSizes[index] ?? null }));
}

function assertAudioReady(chapter: Chapter, scenes: Scene[]): void {
  if (chapter.status !== "ready" || scenes.length === 0) {
    throw HttpError.badRequest("Chapter audio is not ready yet");
  }
  for (const scene of scenes) {
    if (scene.status !== "ready" || !scene.script || !scene.ttsPrompt || !scene.ttsChunks) {
      throw HttpError.badRequest("Chapter audio is not ready yet");
    }
  }
}

/**
 * Concurrent requests hitting the same not-yet-cached chunk must not each
 * independently call the TTS API for it — same dedup pattern as the Podcast
 * side's audio.service.ts, its own independent map (no sharing between the
 * two products).
 */
const inFlightGenerations = new Map<string, Promise<Buffer>>();

function chunkKey(titleId: string, chapterId: string, sceneId: string, index: number): string {
  return `${titleId}:${chapterId}:${sceneId}:${index}`;
}

function getOrStartChunkGeneration(
  titleId: string,
  chapterId: string,
  sceneId: string,
  index: number,
  prompt: string,
  speakers: SpeakerVoice[],
  onDelta: (delta: Buffer) => void,
): { promise: Promise<Buffer>; isLeader: boolean } {
  const key = chunkKey(titleId, chapterId, sceneId, index);
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
    await putCachedChunk(titleId, chapterId, sceneId, index, full);
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
 * Streams the concatenation of every scene's TTS chunks, in order, as one
 * continuous WAV resource spanning the whole chapter — generating (and
 * caching) any chunk on demand the first time it's needed. Reuses the
 * Podcast side's audio.service.ts caching/Range/`?t=` mechanics almost
 * verbatim; the one real adaptation is that each chunk's TTS call uses
 * *that chunk's own scene's* base prompt and *that chunk's own* (≤2)
 * active speakers, resolved from the Title's Cast, rather than one global
 * prompt/cast pair like an episode has.
 */
export async function streamChapterAudio(
  titleId: string,
  chapterId: string,
  chapter: Chapter,
  title: Title,
  res: Response,
  rangeStart: number,
): Promise<void> {
  const scenes = await listScenesOrdered(titleId, chapterId);
  assertAudioReady(chapter, scenes);

  const globalChunks = await buildGlobalChunks(titleId, chapterId, scenes);
  if (globalChunks.length === 0) {
    throw HttpError.badRequest("Chapter has no audio to stream");
  }
  const allCached = globalChunks.every((item) => item.cachedSize !== null);

  res.set("Content-Type", "audio/wav");
  res.set("Accept-Ranges", "bytes");

  if (allCached) {
    const totalPcmBytes = globalChunks.reduce((sum, item) => sum + (item.cachedSize ?? 0), 0);
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
    for (const item of globalChunks) {
      const data = await getCachedChunk(titleId, chapterId, item.sceneId, item.chunk.index);
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
  for (const item of globalChunks) {
    if (stopped) break;
    const chunkStart = pos;

    if (item.cachedSize !== null) {
      const data = await getCachedChunk(titleId, chapterId, item.sceneId, item.chunk.index);
      if (data) writeSlice(res, data, chunkStart, rangeStart);
      pos = chunkStart + (data?.length ?? 0);
      continue;
    }

    const script = item.scene.script;
    const ttsPrompt = item.scene.ttsPrompt;
    if (!script || !ttsPrompt) throw HttpError.badRequest("Chapter audio is not ready yet");

    const chunkText = getChunkText(script, item.chunk);
    const fullPrompt = `${ttsPrompt}\n\n#### TRANSCRIPT\n${chunkText}`;
    const speakers = resolveChunkSpeakers(title.cast, item.chunk);

    let emittedInChunk = 0;
    const { promise, isLeader } = getOrStartChunkGeneration(
      titleId,
      chapterId,
      item.sceneId,
      item.chunk.index,
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
