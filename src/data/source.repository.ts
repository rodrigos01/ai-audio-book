import { randomUUID } from "node:crypto";
import { firestore } from "../config/firebase";
import type { Source } from "../schemas/source.schema";

function sourcesCollection(podcastId: string) {
  return firestore.collection("podcasts").doc(podcastId).collection("sources");
}

export async function createSource(
  podcastId: string,
  input: { title: string; contents: string; sourceType: "text" | "pdf"; originalFilename?: string },
): Promise<Source> {
  const id = randomUUID();
  const source: Source = {
    id,
    title: input.title,
    contents: input.contents,
    sourceType: input.sourceType,
    createdAt: Date.now(),
    ...(input.originalFilename ? { originalFilename: input.originalFilename } : {}),
  };
  await sourcesCollection(podcastId).doc(id).set(source);
  return source;
}

export async function getSource(podcastId: string, sourceId: string): Promise<Source | null> {
  const snap = await sourcesCollection(podcastId).doc(sourceId).get();
  return snap.exists ? (snap.data() as Source) : null;
}

export async function listSources(podcastId: string): Promise<Source[]> {
  const snap = await sourcesCollection(podcastId).orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => doc.data() as Source);
}

export async function deleteSource(podcastId: string, sourceId: string): Promise<boolean> {
  const ref = sourcesCollection(podcastId).doc(sourceId);
  const existing = await ref.get();
  if (!existing.exists) return false;
  await ref.delete();
  return true;
}
