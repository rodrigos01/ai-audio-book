import { randomUUID } from "node:crypto";
import { audiobookFirestore } from "../config/audiobookFirebase";
import type { SceneDraft } from "../schemas/chapterDraft.schema";
import type { Scene } from "../schemas/scene.schema";

function scenesCollection(titleId: string, chapterId: string) {
  return audiobookFirestore
    .collection("titles")
    .doc(titleId)
    .collection("chapters")
    .doc(chapterId)
    .collection("scenes");
}

/**
 * Creates every scene of a confirmed chapter upfront, all `status:
 * "pending"` — mirrors an episode's null generation fields at creation. The
 * generation orchestrator fills each one in as it's processed, in `index`
 * order (not `createdAt`, since all scenes are created together in one
 * batch).
 */
export async function createScenesForChapter(
  titleId: string,
  chapterId: string,
  scenes: SceneDraft[],
): Promise<Scene[]> {
  const now = Date.now();
  const collection = scenesCollection(titleId, chapterId);
  const batch = audiobookFirestore.batch();

  const created: Scene[] = scenes.map((draft, index) => {
    const id = randomUUID();
    const scene: Scene = {
      id,
      index,
      name: draft.name,
      description: draft.description,
      directorNotes: draft.directorNotes,
      sampleContext: draft.sampleContext,
      sourceStartOffset: draft.sourceStartOffset,
      sourceEndOffset: draft.sourceEndOffset,
      script: null,
      ttsPrompt: null,
      ttsChunks: null,
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    batch.set(collection.doc(id), scene);
    return scene;
  });

  await batch.commit();
  return created;
}

export async function getScene(
  titleId: string,
  chapterId: string,
  sceneId: string,
): Promise<Scene | null> {
  const snap = await scenesCollection(titleId, chapterId).doc(sceneId).get();
  return snap.exists ? (snap.data() as Scene) : null;
}

export async function listScenesOrdered(titleId: string, chapterId: string): Promise<Scene[]> {
  const snap = await scenesCollection(titleId, chapterId).orderBy("index", "asc").get();
  return snap.docs.map((doc) => doc.data() as Scene);
}

export async function patchSceneState(
  titleId: string,
  chapterId: string,
  sceneId: string,
  patch: Partial<Scene>,
): Promise<void> {
  await scenesCollection(titleId, chapterId).doc(sceneId).update({ ...patch, updatedAt: Date.now() });
}
