import { Router } from "express";
import * as audiobookAudioController from "../controllers/audiobookAudio.controller";
import { asyncHandler } from "../middleware/asyncHandler";

export const audiobookAudioRouter = Router({ mergeParams: true });

audiobookAudioRouter.get("/stream", asyncHandler(audiobookAudioController.stream));
