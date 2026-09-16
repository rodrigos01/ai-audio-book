import express from "express";
import { asyncHandler } from "./middleware/asyncHandler";
import { errorHandler } from "./middleware/errorHandler";
import { requireAuth } from "./middleware/requireAuth";
import { healthRouter } from "./routes/health.routes";
import { podcastsRouter } from "./routes/podcasts.routes";
import { voicesRouter } from "./routes/voices.routes";

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(healthRouter);
  app.use(voicesRouter);
  app.use("/podcasts", asyncHandler(requireAuth), podcastsRouter);

  app.use(errorHandler);

  return app;
}
