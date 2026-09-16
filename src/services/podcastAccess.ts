import { getPodcast } from "../data/podcast.repository";
import type { Podcast } from "../schemas/podcast.schema";
import { HttpError } from "../utils/HttpError";

/**
 * Shared by every controller nested under /podcasts/:podcastId (sources,
 * episodes, audio) — a podcast that exists but belongs to someone else is
 * treated identically to one that doesn't exist, so we never leak whether
 * a given id belongs to another user.
 */
export async function requireOwnedPodcast(podcastId: string, userId: string): Promise<Podcast> {
  const podcast = await getPodcast(podcastId);
  if (!podcast || podcast.ownerId !== userId) {
    throw HttpError.notFound("Podcast not found");
  }
  return podcast;
}
