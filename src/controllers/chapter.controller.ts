import type { Request, Response } from "express";
import { getSource } from "../data/audiobookSource.repository";
import {
  createChapter,
  deleteChapter,
  getChapter,
  listChapters,
  patchChapterState,
} from "../data/chapter.repository";
import { createScenesForChapter } from "../data/scene.repository";
import { mergeCastMembers, updateTitle } from "../data/title.repository";
import { requireUserId } from "../middleware/requireAuth";
import { chapterConfirmSchema } from "../schemas/chapter.schema";
import { chapterDraftRequestSchema } from "../schemas/chapterDraft.schema";
import { requireOwnedTitle } from "../services/audiobookAccess";
import { runChapterGeneration } from "../services/chapterGeneration/orchestrator";
import { generateChapterDraft } from "../services/chapterWizard.service";
import { HttpError } from "../utils/HttpError";
import { requireParam } from "../utils/params";

export async function draft(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  const title = await requireOwnedTitle(titleId, requireUserId(req));
  const input = chapterDraftRequestSchema.parse(req.body);

  const source = await getSource(titleId, input.sourceId);
  if (!source) throw HttpError.notFound("Source not found");

  const draft = await generateChapterDraft(source, title.cast);
  res.json({ draft });
}

export async function create(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  const title = await requireOwnedTitle(titleId, requireUserId(req));
  const input = chapterConfirmSchema.parse(req.body);

  const source = await getSource(titleId, input.sourceId);
  if (!source) throw HttpError.notFound("Source not found");

  // Confirming commits the (possibly user-edited) draft's characters into
  // the Title's Cast before anything else, so the generation pipeline below
  // sees the up-to-date cast.
  const { cast, touchedIds } = mergeCastMembers(title.cast, input.draft.characters);
  await updateTitle(titleId, { cast });

  const chapter = await createChapter(titleId, {
    name: input.draft.name,
    synopsis: input.draft.synopsis,
    sourceId: input.sourceId,
    castIds: touchedIds,
  });
  await createScenesForChapter(titleId, chapter.id, input.draft.scenes);

  void runChapterGeneration(titleId, chapter.id).catch((err: unknown) => {
    console.error(`Chapter generation failed for ${titleId}/${chapter.id}:`, err);
  });

  res.status(202).json(chapter);
}

export async function list(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  await requireOwnedTitle(titleId, requireUserId(req));
  res.json(await listChapters(titleId));
}

export async function get(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  await requireOwnedTitle(titleId, requireUserId(req));
  const chapter = await getChapter(titleId, requireParam(req.params, "chapterId"));
  if (!chapter) throw HttpError.notFound("Chapter not found");
  res.json(chapter);
}

export async function remove(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  await requireOwnedTitle(titleId, requireUserId(req));
  const deleted = await deleteChapter(titleId, requireParam(req.params, "chapterId"));
  if (!deleted) throw HttpError.notFound("Chapter not found");
  res.status(204).send();
}

export async function status(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  await requireOwnedTitle(titleId, requireUserId(req));
  const chapter = await getChapter(titleId, requireParam(req.params, "chapterId"));
  if (!chapter) throw HttpError.notFound("Chapter not found");
  res.json({ status: chapter.status, progress: chapter.progress, error: chapter.error });
}

export async function regenerate(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  await requireOwnedTitle(titleId, requireUserId(req));
  const chapterId = requireParam(req.params, "chapterId");
  const chapter = await getChapter(titleId, chapterId);
  if (!chapter) throw HttpError.notFound("Chapter not found");
  if (chapter.status === "ready") {
    throw HttpError.badRequest("Chapter is already ready; nothing to regenerate");
  }

  await patchChapterState(titleId, chapterId, { status: "generating", error: null });
  void runChapterGeneration(titleId, chapterId).catch((err: unknown) => {
    console.error(`Chapter regeneration failed for ${titleId}/${chapterId}:`, err);
  });

  res.status(202).json({ status: "generating" });
}
