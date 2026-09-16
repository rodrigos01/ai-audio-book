import { Router } from "express";
import * as titleController from "../controllers/title.controller";
import { asyncHandler } from "../middleware/asyncHandler";
import { audiobookSourcesRouter } from "./audiobookSources.routes";
import { chaptersRouter } from "./chapters.routes";

export const titlesRouter = Router();

titlesRouter.post("/", asyncHandler(titleController.create));
titlesRouter.get("/", asyncHandler(titleController.list));
titlesRouter.get("/:titleId", asyncHandler(titleController.get));
titlesRouter.patch("/:titleId", asyncHandler(titleController.update));
titlesRouter.delete("/:titleId", asyncHandler(titleController.remove));

titlesRouter.use("/:titleId/sources", audiobookSourcesRouter);
titlesRouter.use("/:titleId/chapters", chaptersRouter);
