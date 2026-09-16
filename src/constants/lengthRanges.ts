export type EpisodeLength = "short" | "medium" | "long";

export interface WordRange {
  min: number;
  max: number;
}

// Word-count ranges per specs.md, with `long`'s minimum fixed to close the
// gap against `medium`'s max (specs.md only stated a max of 9000 for `long`).
export const LENGTH_RANGES: Record<EpisodeLength, WordRange> = {
  short: { min: 3500, max: 5000 },
  medium: { min: 6500, max: 8000 },
  long: { min: 8000, max: 9000 },
};
