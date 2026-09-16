// Strips bracketed audio tags (e.g. "[whispers]", "[very fast]") before
// counting, since those are delivery cues, not spoken content.
export function countWords(text: string): number {
  const withoutTags = text.replace(/\[[^\]]*\]/g, " ");
  const words = withoutTags.trim().match(/\S+/g);
  return words ? words.length : 0;
}
