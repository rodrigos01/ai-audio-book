import type { Request, Response } from "express";
import { getEpisode } from "../data/episode.repository";
import { getPodcast } from "../data/podcast.repository";
import { streamEpisodeAudio } from "../services/audio.service";
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
function parseRangeStart(rangeHeader: string | undefined): number {
  if (!rangeHeader) return 0;
  const match = rangeHeader.match(/^bytes=(\d+)-/);
  return match?.[1] ? Number(match[1]) : 0;
}

export async function stream(req: Request, res: Response) {
  const podcastId = requireParam(req.params, "podcastId");
  const episodeId = requireParam(req.params, "episodeId");
  const { podcast, episode } = await loadContext(podcastId, episodeId);
  const rangeStart = parseRangeStart(req.headers.range);

  await streamEpisodeAudio(podcastId, episodeId, episode, podcast, res, rangeStart);
}
