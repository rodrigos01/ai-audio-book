import { randomUUID } from "node:crypto";
import { audiobookFirestore } from "../config/audiobookFirebase";
import { deleteTitleAudio } from "../storage/audiobookAudioCache.repository";
import type { CharacterDraft } from "../schemas/chapterDraft.schema";
import type { Person } from "../schemas/person.schema";
import type { Title, TitleCreateInput, TitleUpdateInput } from "../schemas/title.schema";

const titlesCollection = audiobookFirestore.collection("titles");

export async function createTitle(input: TitleCreateInput, ownerId: string): Promise<Title> {
  const id = randomUUID();
  const now = Date.now();
  const title: Title = {
    id,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    cast: [],
    ownerId,
    createdAt: now,
    updatedAt: now,
  };
  await titlesCollection.doc(id).set(title);
  return title;
}

export async function getTitle(titleId: string): Promise<Title | null> {
  const snap = await titlesCollection.doc(titleId).get();
  return snap.exists ? (snap.data() as Title) : null;
}

// Filtered in memory rather than a Firestore where(ownerId==) + orderBy
// compound query, to avoid depending on a manually-provisioned composite
// index — same reasoning as the podcast repository, fine at this app's
// expected scale (titles per user).
export async function listTitles(ownerId: string): Promise<Title[]> {
  const snap = await titlesCollection.orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => doc.data() as Title).filter((title) => title.ownerId === ownerId);
}

export async function updateTitle(titleId: string, input: TitleUpdateInput): Promise<Title | null> {
  const ref = titlesCollection.doc(titleId);
  const existing = await ref.get();
  if (!existing.exists) return null;

  const patch: Record<string, unknown> = { ...input, updatedAt: Date.now() };
  if (input.cast) {
    const currentCastIds = new Set((existing.data() as Title).cast.map((member) => member.id));
    patch.cast = input.cast.map((member) => ({
      ...member,
      id: member.id && currentCastIds.has(member.id) ? member.id : randomUUID(),
    }));
  }

  await ref.update(patch);
  const updated = await ref.get();
  return updated.data() as Title;
}

export async function deleteTitle(titleId: string): Promise<boolean> {
  const ref = titlesCollection.doc(titleId);
  const existing = await ref.get();
  if (!existing.exists) return false;

  await audiobookFirestore.recursiveDelete(ref);
  await deleteTitleAudio(titleId);
  return true;
}

/**
 * Merges a chapter draft's characters into a Title's existing Cast: a
 * character whose id matches an existing member updates that member in
 * place (name/voice/persona), keeping its id so a Chapter's castIds stay
 * valid across edits; anything else is added as a new member with a fresh
 * id. Cast members not mentioned in `characters` are left untouched. Returns
 * the full merged cast plus the resolved id for each input character, in
 * order, so the caller can set the confirmed Chapter's castIds.
 */
export function mergeCastMembers(
  existingCast: Person[],
  characters: CharacterDraft[],
): { cast: Person[]; touchedIds: string[] } {
  const existingIds = new Set(existingCast.map((member) => member.id));
  const resolved: Person[] = characters.map((character) => ({
    id: character.id && existingIds.has(character.id) ? character.id : randomUUID(),
    name: character.name,
    voice: character.voice,
    persona: character.persona,
  }));
  const resolvedById = new Map(resolved.map((member) => [member.id, member]));
  const merged = existingCast.map((existing) => resolvedById.get(existing.id) ?? existing);
  const newOnes = resolved.filter((member) => !existingIds.has(member.id));
  return { cast: [...merged, ...newOnes], touchedIds: resolved.map((member) => member.id) };
}
