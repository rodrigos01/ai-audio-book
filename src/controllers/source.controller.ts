import type { Request, Response } from "express";
import { createSource, deleteSource, getSource, listSources } from "../data/source.repository";
import { getPodcast } from "../data/podcast.repository";
import { sourceCreateSchema } from "../schemas/source.schema";
import { extractPdfText } from "../services/source.service";
import { HttpError } from "../utils/HttpError";
import { requireParam } from "../utils/params";

async function assertPodcastExists(podcastId: string) {
  const podcast = await getPodcast(podcastId);
  if (!podcast) throw HttpError.notFound("Podcast not found");
}

export async function create(req: Request, res: Response) {
  const podcastId = requireParam(req.params, "podcastId");
  await assertPodcastExists(podcastId);

  if (req.file) {
    const isPdf =
      req.file.mimetype === "application/pdf" || req.file.originalname.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      throw HttpError.badRequest("Only PDF or text uploads are supported");
    }
    const contents = await extractPdfText(req.file.buffer);
    const title = req.body.title || req.file.originalname;
    const source = await createSource(podcastId, {
      title,
      contents,
      sourceType: "pdf",
      originalFilename: req.file.originalname,
    });
    res.status(201).json(source);
    return;
  }

  const input = sourceCreateSchema.parse(req.body);
  const source = await createSource(podcastId, { ...input, sourceType: "text" });
  res.status(201).json(source);
}

export async function list(req: Request, res: Response) {
  const podcastId = requireParam(req.params, "podcastId");
  await assertPodcastExists(podcastId);
  res.json(await listSources(podcastId));
}

export async function get(req: Request, res: Response) {
  const source = await getSource(
    requireParam(req.params, "podcastId"),
    requireParam(req.params, "sourceId"),
  );
  if (!source) throw HttpError.notFound("Source not found");
  res.json(source);
}

export async function remove(req: Request, res: Response) {
  const deleted = await deleteSource(
    requireParam(req.params, "podcastId"),
    requireParam(req.params, "sourceId"),
  );
  if (!deleted) throw HttpError.notFound("Source not found");
  res.status(204).send();
}
