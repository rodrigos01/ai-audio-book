import { storageBucket } from "../config/firebase";

// Raw PCM (audio/l16), not individually WAV-wrapped — chunks are byte
// concatenated in order (scene by scene, chunk by chunk) to form one
// continuous chapter-length stream, so each chunk must be headerless. Same
// bucket as the Podcast side, just a different path prefix — no new bucket
// to provision.
function chunkPath(titleId: string, chapterId: string, sceneId: string, chunkIndex: number): string {
  return `audiobooks/${titleId}/chapters/${chapterId}/scenes/${sceneId}/audio/chunk-${chunkIndex}.pcm`;
}

export async function getCachedChunk(
  titleId: string,
  chapterId: string,
  sceneId: string,
  chunkIndex: number,
): Promise<Buffer | null> {
  const file = storageBucket.file(chunkPath(titleId, chapterId, sceneId, chunkIndex));
  const [exists] = await file.exists();
  if (!exists) return null;
  const [contents] = await file.download();
  return contents;
}

/** Cheap size check (no download) — used to compute byte offsets across chunks for Range requests. */
export async function getCachedChunkSize(
  titleId: string,
  chapterId: string,
  sceneId: string,
  chunkIndex: number,
): Promise<number | null> {
  const file = storageBucket.file(chunkPath(titleId, chapterId, sceneId, chunkIndex));
  try {
    const [metadata] = await file.getMetadata();
    return metadata.size ? Number(metadata.size) : 0;
  } catch {
    return null;
  }
}

export async function putCachedChunk(
  titleId: string,
  chapterId: string,
  sceneId: string,
  chunkIndex: number,
  data: Buffer,
): Promise<void> {
  const file = storageBucket.file(chunkPath(titleId, chapterId, sceneId, chunkIndex));
  await file.save(data, { contentType: "audio/l16" });
}

export async function deleteChapterAudio(titleId: string, chapterId: string): Promise<void> {
  const prefix = `audiobooks/${titleId}/chapters/${chapterId}/`;
  await storageBucket.deleteFiles({ prefix });
}

export async function deleteTitleAudio(titleId: string): Promise<void> {
  const prefix = `audiobooks/${titleId}/`;
  await storageBucket.deleteFiles({ prefix });
}
