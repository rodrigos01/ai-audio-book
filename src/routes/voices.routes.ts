import { Router } from "express";
import { VOICES } from "../constants/voices";

export const voicesRouter = Router();

voicesRouter.get("/voices", (_req, res) => {
  res.json(VOICES);
});
