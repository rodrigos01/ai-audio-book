import type { Request, Response } from "express";
import {
  createSource,
  deleteSource,
  getSource,
  listSources,
} from "../data/audiobookSource.repository";
import { requireUserId } from "../middleware/requireAuth";
import { sourceCreateSchema } from "../schemas/source.schema";
import { requireOwnedTitle } from "../services/audiobookAccess";
import { extractPdfText } from "../services/source.service";
import { HttpError } from "../utils/HttpError";
import { requireParam } from "../utils/params";

export async function create(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  await requireOwnedTitle(titleId, requireUserId(req));

  if (req.file) {
    const isPdf =
      req.file.mimetype === "application/pdf" || req.file.originalname.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      throw HttpError.badRequest("Only PDF or text uploads are supported");
    }
    const contents = await extractPdfText(req.file.buffer);
    const title = req.body.title || req.file.originalname;
    const source = await createSource(titleId, {
      title,
      contents,
      sourceType: "pdf",
      originalFilename: req.file.originalname,
    });
    res.status(201).json(source);
    return;
  }

  const input = sourceCreateSchema.parse(req.body);
  const source = await createSource(titleId, { ...input, sourceType: "text" });
  res.status(201).json(source);
}

export async function list(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  await requireOwnedTitle(titleId, requireUserId(req));
  res.json(await listSources(titleId));
}

export async function get(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  await requireOwnedTitle(titleId, requireUserId(req));
  const source = await getSource(titleId, requireParam(req.params, "sourceId"));
  if (!source) throw HttpError.notFound("Source not found");
  res.json(source);
}

export async function remove(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  await requireOwnedTitle(titleId, requireUserId(req));
  const deleted = await deleteSource(titleId, requireParam(req.params, "sourceId"));
  if (!deleted) throw HttpError.notFound("Source not found");
  res.status(204).send();
}
