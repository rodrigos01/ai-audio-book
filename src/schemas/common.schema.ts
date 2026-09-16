import { z } from "zod";
import { VOICE_IDS } from "../constants/voices";

export const voiceIdSchema = z.enum(VOICE_IDS);

export const episodeLengthSchema = z.enum(["short", "medium", "long"]);
