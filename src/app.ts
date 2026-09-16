import express from "express";
import { errorHandler } from "./middleware/errorHandler";
import { healthRouter } from "./routes/health.routes";
import { podcastsRouter } from "./routes/podcasts.routes";
import { voicesRouter } from "./routes/voices.routes";

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(healthRouter);
  app.use(voicesRouter);
  app.use("/podcasts", podcastsRouter);

  app.use(errorHandler);

  return app;
}
