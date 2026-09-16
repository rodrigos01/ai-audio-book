import { Router } from "express";
import * as episodeController from "../controllers/episode.controller";
import { asyncHandler } from "../middleware/asyncHandler";
import { audioRouter } from "./audio.routes";

export const episodesRouter = Router({ mergeParams: true });

episodesRouter.post("/wizard/options", asyncHandler(episodeController.wizardOptions));
episodesRouter.post("/wizard/revise", asyncHandler(episodeController.wizardRevise));

episodesRouter.post("/", asyncHandler(episodeController.create));
episodesRouter.get("/", asyncHandler(episodeController.list));
episodesRouter.get("/:episodeId", asyncHandler(episodeController.get));
episodesRouter.get("/:episodeId/status", asyncHandler(episodeController.status));
episodesRouter.patch("/:episodeId", asyncHandler(episodeController.update));
episodesRouter.delete("/:episodeId", asyncHandler(episodeController.remove));
episodesRouter.post("/:episodeId/regenerate", asyncHandler(episodeController.regenerate));

episodesRouter.use("/:episodeId/audio", audioRouter);
