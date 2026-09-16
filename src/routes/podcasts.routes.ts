import { Router } from "express";
import * as podcastController from "../controllers/podcast.controller";
import { asyncHandler } from "../middleware/asyncHandler";
import { sourcesRouter } from "./sources.routes";
import { episodesRouter } from "./episodes.routes";

export const podcastsRouter = Router();

podcastsRouter.post("/wizard/options", asyncHandler(podcastController.wizardOptions));
podcastsRouter.post("/wizard/revise", asyncHandler(podcastController.wizardRevise));

podcastsRouter.post("/", asyncHandler(podcastController.create));
podcastsRouter.get("/", asyncHandler(podcastController.list));
podcastsRouter.get("/:podcastId", asyncHandler(podcastController.get));
podcastsRouter.patch("/:podcastId", asyncHandler(podcastController.update));
podcastsRouter.delete("/:podcastId", asyncHandler(podcastController.remove));

podcastsRouter.use("/:podcastId/sources", sourcesRouter);
podcastsRouter.use("/:podcastId/episodes", episodesRouter);
