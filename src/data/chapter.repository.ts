import { randomUUID } from "node:crypto";
import { audiobookFirestore } from "../config/audiobookFirebase";
import { deleteChapterAudio } from "../storage/audiobookAudioCache.repository";
import type { Chapter } from "../schemas/chapter.schema";

function chaptersCollection(titleId: string) {
  return audiobookFirestore.collection("titles").doc(titleId).collection("chapters");
}

export interface ChapterCreateInput {
  name: string;
  synopsis: string;
  sourceId: string;
  castIds: string[];
}

export async function createChapter(titleId: string, input: ChapterCreateInput): Promise<Chapter> {
  const id = randomUUID();
  const now = Date.now();
  const chapter: Chapter = {
    id,
    name: input.name,
    synopsis: input.synopsis,
    sourceId: input.sourceId,
    castIds: input.castIds,
    status: "generating",
    progress: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await chaptersCollection(titleId).doc(id).set(chapter);
  return chapter;
}

export async function getChapter(titleId: string, chapterId: string): Promise<Chapter | null> {
  const snap = await chaptersCollection(titleId).doc(chapterId).get();
  return snap.exists ? (snap.data() as Chapter) : null;
}

export async function listChapters(titleId: string): Promise<Chapter[]> {
  const snap = await chaptersCollection(titleId).orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => doc.data() as Chapter);
}

export async function deleteChapter(titleId: string, chapterId: string): Promise<boolean> {
  const ref = chaptersCollection(titleId).doc(chapterId);
  const existing = await ref.get();
  if (!existing.exists) return false;

  await audiobookFirestore.recursiveDelete(ref);
  await deleteChapterAudio(titleId, chapterId);
  return true;
}

export async function patchChapterState(
  titleId: string,
  chapterId: string,
  patch: Partial<Chapter>,
): Promise<void> {
  await chaptersCollection(titleId).doc(chapterId).update({ ...patch, updatedAt: Date.now() });
}
