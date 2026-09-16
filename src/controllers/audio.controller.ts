import type { Request, Response } from "express";
import { getEpisode } from "../data/episode.repository";
import { getPodcast } from "../data/podcast.repository";
import { streamEpisodeAudio } from "../services/audio.service";
import { secondsToByteOffset } from "../utils/wav";
import { HttpError } from "../utils/HttpError";
import { requireParam } from "../utils/params";

async function loadContext(podcastId: string, episodeId: string) {
  const podcast = await getPodcast(podcastId);
  if (!podcast) throw HttpError.notFound("Podcast not found");
  const episode = await getEpisode(podcastId, episodeId);
  if (!episode) throw HttpError.notFound("Episode not found");
  return { podcast, episode };
}

// We only support an open-ended "bytes=START-" range (what players use to
// resume playback) — a bounded "bytes=START-END" window is parsed for its
// start only; we still stream through to the end of the episode regardless.
function parseRangeStart(rangeHeader: string | undefined): number | null {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/^bytes=(\d+)-/);
  return match?.[1] ? Number(match[1]) : null;
}

// `t` (seconds) lets a client resume from a saved playback position without
// needing to know this app's PCM format to compute a byte offset itself —
// e.g. "the user left off at 12:34, they're back, start the stream there."
// A `Range` header, if present, takes precedence (that's what a player's
// own native seek — <audio>.currentTime — actually issues).
function parseStartTime(query: Request["query"]): number | null {
  const raw = query.t;
  if (typeof raw !== "string") return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export async function stream(req: Request, res: Response) {
  const podcastId = requireParam(req.params, "podcastId");
  const episodeId = requireParam(req.params, "episodeId");
  const { podcast, episode } = await loadContext(podcastId, episodeId);

  const rangeStart = parseRangeStart(req.headers.range);
  const startTime = parseStartTime(req.query);
  const resolvedStart = rangeStart ?? (startTime !== null ? secondsToByteOffset(startTime) : 0);

  await streamEpisodeAudio(podcastId, episodeId, episode, podcast, res, resolvedStart);
}
