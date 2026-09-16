import { randomUUID } from "node:crypto";
import { audiobookFirestore } from "../config/audiobookFirebase";
import type { Source } from "../schemas/source.schema";

function sourcesCollection(titleId: string) {
  return audiobookFirestore.collection("titles").doc(titleId).collection("sources");
}

export async function createSource(
  titleId: string,
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
  await sourcesCollection(titleId).doc(id).set(source);
  return source;
}

export async function getSource(titleId: string, sourceId: string): Promise<Source | null> {
  const snap = await sourcesCollection(titleId).doc(sourceId).get();
  return snap.exists ? (snap.data() as Source) : null;
}

export async function listSources(titleId: string): Promise<Source[]> {
  const snap = await sourcesCollection(titleId).orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => doc.data() as Source);
}

export async function deleteSource(titleId: string, sourceId: string): Promise<boolean> {
  const ref = sourcesCollection(titleId).doc(sourceId);
  const existing = await ref.get();
  if (!existing.exists) return false;
  await ref.delete();
  return true;
}
