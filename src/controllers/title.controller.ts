import type { Request, Response } from "express";
import { createTitle, deleteTitle, listTitles, updateTitle } from "../data/title.repository";
import { requireUserId } from "../middleware/requireAuth";
import { titleCreateSchema, titleUpdateSchema } from "../schemas/title.schema";
import { requireOwnedTitle } from "../services/audiobookAccess";
import { HttpError } from "../utils/HttpError";
import { requireParam } from "../utils/params";

export async function create(req: Request, res: Response) {
  const input = titleCreateSchema.parse(req.body);
  const title = await createTitle(input, requireUserId(req));
  res.status(201).json(title);
}

export async function list(req: Request, res: Response) {
  res.json(await listTitles(requireUserId(req)));
}

export async function get(req: Request, res: Response) {
  const title = await requireOwnedTitle(requireParam(req.params, "titleId"), requireUserId(req));
  res.json(title);
}

export async function update(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  await requireOwnedTitle(titleId, requireUserId(req));
  const input = titleUpdateSchema.parse(req.body);
  const title = await updateTitle(titleId, input);
  if (!title) throw HttpError.notFound("Title not found");
  res.json(title);
}

export async function remove(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  await requireOwnedTitle(titleId, requireUserId(req));
  await deleteTitle(titleId);
  res.status(204).send();
}
