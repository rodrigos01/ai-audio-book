import { countTokens } from "../../llm/geminiClient";
import { getSource } from "../../data/audiobookSource.repository";
import { getChapter, patchChapterState } from "../../data/chapter.repository";
import { listScenesOrdered, patchSceneState } from "../../data/scene.repository";
import { getTitle } from "../../data/title.repository";
import { chunkSceneScript } from "./sceneChunker";
import { generateSceneScript } from "./sceneDirector.service";
import { renderScenePrompt } from "./scenePromptRenderer";

/**
 * Drives a confirmed chapter's generation, one scene at a time, in
 * committed order — no multi-agent conversation, continuity condensation,
 * or speaker-selection step the way an episode has; a chapter's content is
 * fixed source text, not a simulated conversation. Each scene's result is
 * persisted immediately as it's produced (patchSceneState), so a crash
 * mid-chapter loses at most the in-flight scene, matching the per-turn
 * persistence philosophy already used for episodes. `regenerate` restarts
 * this whole loop from scratch — there is no partial-resume support, same
 * documented (not a bug) gap as the Podcast side.
 */
export async function runChapterGeneration(titleId: string, chapterId: string): Promise<void> {
  try {
    const title = await getTitle(titleId);
    if (!title) throw new Error(`Title ${titleId} not found`);
    const chapter = await getChapter(titleId, chapterId);
    if (!chapter) throw new Error(`Chapter ${chapterId} not found`);
    const source = await getSource(titleId, chapter.sourceId);
    if (!source) throw new Error(`Source ${chapter.sourceId} not found`);

    const scenes = await listScenesOrdered(titleId, chapterId);
    const totalScenes = scenes.length;

    for (const scene of scenes) {
      await patchChapterState(titleId, chapterId, {
        progress: { currentSceneIndex: scene.index, totalScenes },
      });

      const sourceSpan = source.contents.slice(scene.sourceStartOffset, scene.sourceEndOffset);
      const script = await generateSceneScript(scene.name, sourceSpan, title.cast);
      await patchSceneState(titleId, chapterId, scene.id, { script, status: "scripted" });

      const ttsPrompt = renderScenePrompt(scene, script, title.cast);
      const basePromptTokens = await countTokens(ttsPrompt);
      const ttsChunks = chunkSceneScript(script, basePromptTokens);

      await patchSceneState(titleId, chapterId, scene.id, { ttsPrompt, ttsChunks, status: "ready" });
    }

    await patchChapterState(titleId, chapterId, {
      status: "ready",
      progress: { currentSceneIndex: totalScenes, totalScenes },
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await patchChapterState(titleId, chapterId, { status: "failed", error: message }).catch((patchErr) => {
      console.error(`Failed to mark chapter ${titleId}/${chapterId} as failed:`, patchErr);
    });
    throw err;
  }
}
