const SPEAKER_LABEL_RE = /^\[([^\]]+)\]:/;

/**
 * Every distinct speaker labeled in a "[Speaker]: text" formatted script,
 * in order of first appearance. Used to figure out which characters
 * actually speak in a given scene's generated script, without re-deriving
 * it from the draft's cast list (a script may use fewer characters than the
 * scene was originally expected to feature).
 */
export function extractSpeakerNames(script: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const turn of script.split("\n\n")) {
    const name = turn.match(SPEAKER_LABEL_RE)?.[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}
