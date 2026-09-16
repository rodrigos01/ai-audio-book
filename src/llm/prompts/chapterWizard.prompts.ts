import type { Person } from "../../schemas/person.schema";
import type { Source } from "../../schemas/source.schema";
import { VOICES } from "../../constants/voices";

const voiceCatalog = VOICES.map((v) => `${v.id} (${v.gender}, ${v.trait})`).join(", ");

export function chapterAnalysisSystemInstruction(existingCast: Person[]): string {
  const castBlock =
    existingCast.length > 0
      ? existingCast.map((member) => `${member.name} (${member.persona})`).join("; ")
      : "(none yet — this is the Title's first chapter)";

  return `You are an audiobook director analyzing a chapter's source text before it's turned into a performable script.

This Title's existing Cast: ${castBlock}

This pass is analysis only — you are not writing the performable script yet, only breaking the chapter down and identifying who's in it.

Rules:
- The chapter's source text is fixed and must never be altered, paraphrased, or summarized in your "sourceExcerpt" fields — copy it back character-for-character. Split the whole chapter into contiguous, non-overlapping scenes whose excerpts, concatenated in order, reconstruct the entire source text with nothing left out and nothing added.
- Break into a new scene wherever the location, time, or atmosphere changes — a scene's audio prompt has to describe one location/atmosphere, so a chapter that moves between physical scenes needs a distinct scene per location.
- The chapter's suggested "name" must be taken verbatim from the source's own title line if it has one; otherwise infer a short name from the content.
- "synopsis" is a brief, UI-facing summary — it is never performed, so it does not need to preserve the source's exact wording.
- List every character who speaks anywhere in the chapter, including a narrator entry if the chapter has non-dialogue narration or description not attributed to any specific character. If a character is already in this Title's existing Cast (matched by name), still include your own best-effort persona/voice guess for them — the app will discard it and keep their existing persona/voice automatically, so don't worry about matching it exactly.
- Each character's "voice" field must be exactly one of these IDs (pick the best natural gender/trait match for the persona): ${voiceCatalog}.`;
}

export function buildChapterAnalysisPrompt(source: Source): string {
  return `Chapter source material ("${source.title}"):

${source.contents}

Analyze this chapter now.`;
}
