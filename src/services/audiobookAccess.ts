import { getTitle } from "../data/title.repository";
import type { Title } from "../schemas/title.schema";
import { HttpError } from "../utils/HttpError";

/**
 * Shared by every controller nested under /audiobooks/:titleId (sources,
 * chapters, audio) — a title that exists but belongs to someone else is
 * treated identically to one that doesn't exist, so we never leak whether a
 * given id belongs to another user. Same pattern as podcastAccess.ts.
 */
export async function requireOwnedTitle(titleId: string, userId: string): Promise<Title> {
  const title = await getTitle(titleId);
  if (!title || title.ownerId !== userId) {
    throw HttpError.notFound("Title not found");
  }
  return title;
}
