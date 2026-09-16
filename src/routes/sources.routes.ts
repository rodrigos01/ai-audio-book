import { Router } from "express";
import * as sourceController from "../controllers/source.controller";
import { asyncHandler } from "../middleware/asyncHandler";
import { upload } from "../middleware/upload";

export const sourcesRouter = Router({ mergeParams: true });

sourcesRouter.post("/", upload.single("file"), asyncHandler(sourceController.create));
sourcesRouter.get("/", asyncHandler(sourceController.list));
sourcesRouter.get("/:sourceId", asyncHandler(sourceController.get));
sourcesRouter.delete("/:sourceId", asyncHandler(sourceController.remove));
