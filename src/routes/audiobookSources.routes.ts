import { Router } from "express";
import * as audiobookSourceController from "../controllers/audiobookSource.controller";
import { asyncHandler } from "../middleware/asyncHandler";
import { upload } from "../middleware/upload";

export const audiobookSourcesRouter = Router({ mergeParams: true });

audiobookSourcesRouter.post("/", upload.single("file"), asyncHandler(audiobookSourceController.create));
audiobookSourcesRouter.get("/", asyncHandler(audiobookSourceController.list));
audiobookSourcesRouter.get("/:sourceId", asyncHandler(audiobookSourceController.get));
audiobookSourcesRouter.delete("/:sourceId", asyncHandler(audiobookSourceController.remove));
