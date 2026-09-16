import { randomUUID } from "node:crypto";
import { firestore } from "../config/firebase";
import { deletePodcastAudio } from "../storage/audioCache.repository";
import type { Podcast, PodcastCreateInput, PodcastUpdateInput } from "../schemas/podcast.schema";

const podcastsCollection = firestore.collection("podcasts");

export async function createPodcast(input: PodcastCreateInput, ownerId: string): Promise<Podcast> {
  const id = randomUUID();
  const now = Date.now();
  const podcast: Podcast = {
    id,
    title: input.title,
    description: input.description,
    structure: input.structure,
    hosts: input.hosts.map((host) => ({ ...host, id: randomUUID() })),
    ownerId,
    createdAt: now,
    updatedAt: now,
  };
  await podcastsCollection.doc(id).set(podcast);
  return podcast;
}

export async function getPodcast(podcastId: string): Promise<Podcast | null> {
  const snap = await podcastsCollection.doc(podcastId).get();
  return snap.exists ? (snap.data() as Podcast) : null;
}

// Filtered in memory rather than a Firestore `where(ownerId==) + orderBy`
// compound query, to avoid depending on a manually-provisioned composite
// index — same reasoning as getRecentCondensedSummariesForHost, fine at
// this app's expected scale (podcasts per user).
export async function listPodcasts(ownerId: string): Promise<Podcast[]> {
  const snap = await podcastsCollection.orderBy("createdAt", "desc").get();
  return snap.docs
    .map((doc) => doc.data() as Podcast)
    .filter((podcast) => podcast.ownerId === ownerId);
}

export async function updatePodcast(
  podcastId: string,
  input: PodcastUpdateInput,
): Promise<Podcast | null> {
  const ref = podcastsCollection.doc(podcastId);
  const existing = await ref.get();
  if (!existing.exists) return null;

  const patch: Record<string, unknown> = { ...input, updatedAt: Date.now() };
  if (input.hosts) {
    const currentHostIds = new Set(
      (existing.data() as Podcast).hosts.map((host) => host.id),
    );
    patch.hosts = input.hosts.map((host) => ({
      ...host,
      id: host.id && currentHostIds.has(host.id) ? host.id : randomUUID(),
    }));
  }

  await ref.update(patch);
  const updated = await ref.get();
  return updated.data() as Podcast;
}

export async function deletePodcast(podcastId: string): Promise<boolean> {
  const ref = podcastsCollection.doc(podcastId);
  const existing = await ref.get();
  if (!existing.exists) return false;

  await firestore.recursiveDelete(ref);
  await deletePodcastAudio(podcastId);
  return true;
}
