import { Router } from "express";
import * as chapterController from "../controllers/chapter.controller";
import { asyncHandler } from "../middleware/asyncHandler";
import { audiobookAudioRouter } from "./audiobookAudio.routes";

export const chaptersRouter = Router({ mergeParams: true });

chaptersRouter.post("/draft", asyncHandler(chapterController.draft));

chaptersRouter.post("/", asyncHandler(chapterController.create));
chaptersRouter.get("/", asyncHandler(chapterController.list));
chaptersRouter.get("/:chapterId", asyncHandler(chapterController.get));
chaptersRouter.get("/:chapterId/status", asyncHandler(chapterController.status));
chaptersRouter.delete("/:chapterId", asyncHandler(chapterController.remove));
chaptersRouter.post("/:chapterId/regenerate", asyncHandler(chapterController.regenerate));

chaptersRouter.use("/:chapterId/audio", audiobookAudioRouter);
