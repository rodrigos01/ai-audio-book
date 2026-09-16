import { randomUUID } from "node:crypto";
import { firestore } from "../config/firebase";
import { deleteEpisodeAudio } from "../storage/audioCache.repository";
import type { Episode, EpisodeCreateInput, EpisodeUpdateInput } from "../schemas/episode.schema";

function episodesCollection(podcastId: string) {
  return firestore.collection("podcasts").doc(podcastId).collection("episodes");
}

export async function createEpisode(
  podcastId: string,
  input: EpisodeCreateInput,
): Promise<Episode> {
  const id = randomUUID();
  const now = Date.now();
  const episode: Episode = {
    id,
    title: input.title,
    topics: input.topics,
    length: input.length,
    sourceIds: input.sourceIds,
    participantHostIds: input.participantHostIds,
    guests: input.guests.map((guest) => ({ ...guest, id: randomUUID() })),
    productionNotes: input.productionNotes,
    status: "generating",
    progress: null,
    transcript: null,
    ttsPrompt: null,
    ttsChunks: null,
    condensedSummaries: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await episodesCollection(podcastId).doc(id).set(episode);
  return episode;
}

export async function getEpisode(podcastId: string, episodeId: string): Promise<Episode | null> {
  const snap = await episodesCollection(podcastId).doc(episodeId).get();
  return snap.exists ? (snap.data() as Episode) : null;
}

export async function listEpisodes(podcastId: string): Promise<Episode[]> {
  const snap = await episodesCollection(podcastId).orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => doc.data() as Episode);
}

export async function updateEpisode(
  podcastId: string,
  episodeId: string,
  input: EpisodeUpdateInput,
): Promise<Episode | null> {
  const ref = episodesCollection(podcastId).doc(episodeId);
  const existing = await ref.get();
  if (!existing.exists) return null;

  await ref.update({ ...input, updatedAt: Date.now() });
  const updated = await ref.get();
  return updated.data() as Episode;
}

export async function deleteEpisode(podcastId: string, episodeId: string): Promise<boolean> {
  const ref = episodesCollection(podcastId).doc(episodeId);
  const existing = await ref.get();
  if (!existing.exists) return false;
  await ref.delete();
  await deleteEpisodeAudio(podcastId, episodeId);
  return true;
}

export async function getRecentCondensedSummariesForHost(
  podcastId: string,
  hostId: string,
  excludeEpisodeId: string,
  limit = 5,
): Promise<string[]> {
  // Filtered in memory (rather than a Firestore array-contains + orderBy
  // compound query) to avoid depending on a manually-provisioned composite
  // index — fine at this app's expected scale of episodes per podcast.
  const episodes = await listEpisodes(podcastId);
  return episodes
    .filter(
      (episode) =>
        episode.id !== excludeEpisodeId &&
        episode.status === "ready" &&
        episode.participantHostIds.includes(hostId),
    )
    .slice(0, limit)
    .map((episode) => episode.condensedSummaries?.[hostId])
    .filter((summary): summary is string => Boolean(summary));
}

export async function patchEpisodeState(
  podcastId: string,
  episodeId: string,
  patch: Partial<Episode>,
): Promise<void> {
  await episodesCollection(podcastId).doc(episodeId).update({ ...patch, updatedAt: Date.now() });
}
