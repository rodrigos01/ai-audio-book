import type { Request, Response } from "express";
import { getPodcast } from "../data/podcast.repository";
import {
  createEpisode,
  deleteEpisode,
  getEpisode,
  listEpisodes,
  updateEpisode,
} from "../data/episode.repository";
import { getSource } from "../data/source.repository";
import { episodeCreateSchema, episodeUpdateSchema } from "../schemas/episode.schema";
import {
  episodeWizardOptionsRequestSchema,
  episodeWizardReviseRequestSchema,
} from "../schemas/wizard.schema";
import * as episodeWizardService from "../services/episodeWizard.service";
import { runEpisodeGeneration } from "../services/episodeGeneration/orchestrator";
import { HttpError } from "../utils/HttpError";
import { requireParam } from "../utils/params";

async function requirePodcast(podcastId: string) {
  const podcast = await getPodcast(podcastId);
  if (!podcast) throw HttpError.notFound("Podcast not found");
  return podcast;
}

export async function wizardOptions(req: Request, res: Response) {
  const podcastId = requireParam(req.params, "podcastId");
  const podcast = await requirePodcast(podcastId);
  const input = episodeWizardOptionsRequestSchema.parse(req.body);

  const sources = (
    await Promise.all(input.sourceIds.map((sourceId) => getSource(podcastId, sourceId)))
  ).filter((s): s is NonNullable<typeof s> => s !== null);

  const draft = await episodeWizardService.generateDraft(podcast, sources, input.prompt);
  res.json({ draft });
}

export async function wizardRevise(req: Request, res: Response) {
  const podcast = await requirePodcast(requireParam(req.params, "podcastId"));
  const input = episodeWizardReviseRequestSchema.parse(req.body);
  const draft = await episodeWizardService.reviseDraft(podcast, input.draft, input.instruction);
  res.json({ draft });
}

export async function create(req: Request, res: Response) {
  const podcastId = requireParam(req.params, "podcastId");
  await requirePodcast(podcastId);
  const input = episodeCreateSchema.parse(req.body);
  const episode = await createEpisode(podcastId, input);

  void runEpisodeGeneration(podcastId, episode.id).catch((err: unknown) => {
    console.error(`Episode generation failed for ${podcastId}/${episode.id}:`, err);
  });

  res.status(202).json(episode);
}

export async function list(req: Request, res: Response) {
  const podcastId = requireParam(req.params, "podcastId");
  await requirePodcast(podcastId);
  res.json(await listEpisodes(podcastId));
}

export async function get(req: Request, res: Response) {
  const episode = await getEpisode(
    requireParam(req.params, "podcastId"),
    requireParam(req.params, "episodeId"),
  );
  if (!episode) throw HttpError.notFound("Episode not found");
  res.json(episode);
}

export async function status(req: Request, res: Response) {
  const episode = await getEpisode(
    requireParam(req.params, "podcastId"),
    requireParam(req.params, "episodeId"),
  );
  if (!episode) throw HttpError.notFound("Episode not found");
  res.json({ status: episode.status, progress: episode.progress, error: episode.error });
}

export async function update(req: Request, res: Response) {
  const input = episodeUpdateSchema.parse(req.body);
  const episode = await updateEpisode(
    requireParam(req.params, "podcastId"),
    requireParam(req.params, "episodeId"),
    input,
  );
  if (!episode) throw HttpError.notFound("Episode not found");
  res.json(episode);
}

export async function remove(req: Request, res: Response) {
  const deleted = await deleteEpisode(
    requireParam(req.params, "podcastId"),
    requireParam(req.params, "episodeId"),
  );
  if (!deleted) throw HttpError.notFound("Episode not found");
  res.status(204).send();
}

export async function regenerate(req: Request, res: Response) {
  const podcastId = requireParam(req.params, "podcastId");
  const episodeId = requireParam(req.params, "episodeId");
  const episode = await getEpisode(podcastId, episodeId);
  if (!episode) throw HttpError.notFound("Episode not found");
  if (episode.status === "ready") {
    throw HttpError.badRequest("Episode is already ready; nothing to regenerate");
  }

  void runEpisodeGeneration(podcastId, episodeId).catch((err: unknown) => {
    console.error(`Episode regeneration failed for ${podcastId}/${episodeId}:`, err);
  });

  res.status(202).json({ status: "generating" });
}
