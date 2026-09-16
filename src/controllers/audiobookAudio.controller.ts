import type { Request, Response } from "express";
import { getChapter } from "../data/chapter.repository";
import { requireUserId } from "../middleware/requireAuth";
import { requireOwnedTitle } from "../services/audiobookAccess";
import { streamChapterAudio } from "../services/audiobookAudio.service";
import { secondsToByteOffset } from "../utils/wav";
import { HttpError } from "../utils/HttpError";
import { requireParam } from "../utils/params";

async function loadContext(titleId: string, chapterId: string, userId: string) {
  const title = await requireOwnedTitle(titleId, userId);
  const chapter = await getChapter(titleId, chapterId);
  if (!chapter) throw HttpError.notFound("Chapter not found");
  return { title, chapter };
}

// We only support an open-ended "bytes=START-" range (what players use to
// resume playback) — a bounded "bytes=START-END" window is parsed for its
// start only; we still stream through to the end of the chapter regardless.
function parseRangeStart(rangeHeader: string | undefined): number | null {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/^bytes=(\d+)-/);
  return match?.[1] ? Number(match[1]) : null;
}

function parseStartTime(query: Request["query"]): number | null {
  const raw = query.t;
  if (typeof raw !== "string") return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export async function stream(req: Request, res: Response) {
  const titleId = requireParam(req.params, "titleId");
  const chapterId = requireParam(req.params, "chapterId");
  const { title, chapter } = await loadContext(titleId, chapterId, requireUserId(req));

  const rangeStart = parseRangeStart(req.headers.range);
  const startTime = parseStartTime(req.query);
  const resolvedStart = rangeStart ?? (startTime !== null ? secondsToByteOffset(startTime) : 0);

  await streamChapterAudio(titleId, chapterId, chapter, title, res, resolvedStart);
}
