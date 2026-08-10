const firestoreStore = require('../stores/firestoreStore');
const audioFileStore = require('../stores/audioFileStore');
const { breakContentIntoSections, splitSSMLIntoSections, buildSectionItems } = require('../services/textSplitterService');
const { deleteChapterSections, synthesizeAndCacheSection } = require('../services/ttsService');
const { debugLog } = require('../services/logger');
const { NotFoundError, ForbiddenError } = require('../utils/errors');

class ChapterController {
  async updateChapter({ id, name, content, is_ssml, clientId, userId }) {
    const chapter = await firestoreStore.getChapterWithTitle(id, clientId, userId);
    if (!chapter) throw new NotFoundError('Chapter not found or access denied');

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (is_ssml !== undefined) updateData.is_ssml = is_ssml;
    if (content !== undefined) updateData.content = content;

    await firestoreStore.updateChapter(id, updateData);

    if (content !== undefined) {
      await deleteChapterSections(id);

      const newSections = (is_ssml || chapter.is_ssml)
        ? splitSSMLIntoSections(content)
        : breakContentIntoSections(content);

      const sectionData = buildSectionItems(id, newSections);
      await firestoreStore.insertSections(sectionData);
    }

    return { success: true };
  }

  async deleteChapter({ id }) {
    await deleteChapterSections(id);
    await firestoreStore.deleteChapter(id);
    return { success: true };
  }

  async prepareChapter({ chapterId, clientId, userId, isClosedCheck, deadlineMs = 50000 }) {
    const chapter = await firestoreStore.getChapter(chapterId);
    if (!chapter) throw new NotFoundError('Chapter not found');
    const title = await firestoreStore.getTitle(chapter.title_id, clientId, userId) || await firestoreStore.getTitleById(chapter.title_id);
    if (!title) throw new ForbiddenError('Forbidden');

    const deadline = Date.now() + deadlineMs;
    const sections = await firestoreStore.getSections(chapterId, 0);
    let generatedCount = 0;

    for (const section of sections) {
      if (isClosedCheck && isClosedCheck()) break;

      if (audioFileStore.readSectionAudio(section.id)) {
        generatedCount++;
        continue;
      }

      if (Date.now() > deadline) break;

      const audioBuffer = await synthesizeAndCacheSection(title, chapter, section);
      if (audioBuffer) generatedCount++;
    }

    return {
      totalSections: sections.length,
      generatedSections: generatedCount,
      ready: generatedCount === sections.length
    };
  }

  async streamChapterAudio({ chapterId, offset = 0, onReady, onAudioChunk, isClosedCheck }) {
    const chapter = await firestoreStore.getChapter(chapterId);
    if (!chapter) throw new NotFoundError('Chapter not found');
    const title = await firestoreStore.getTitleById(chapter.title_id);

    debugLog(`Streaming ${chapterId} starting from offset ${offset}`);
    const sections = await firestoreStore.getSections(chapterId, offset);
    debugLog(`Found ${sections.length} sections for offset ${offset}`);
    if (sections.length === 0) {
      debugLog(`No sections found for ${chapterId} with offset ${offset}. Chapter likely has fewer sections.`);
      throw new NotFoundError('Section offset out of bounds');
    }

    if (onReady) {
      onReady({ totalSections: sections.length });
    }

    for (const section of sections) {
      if (isClosedCheck && isClosedCheck()) break;

      const audioBuffer = audioFileStore.readSectionAudio(section.id)
        || await synthesizeAndCacheSection(title, chapter, section);

      if (audioBuffer && onAudioChunk) {
        onAudioChunk(audioBuffer, section);
      }
    }
  }
}

module.exports = new ChapterController();
