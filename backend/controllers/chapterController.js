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
    if (chapter.ai_casting_status === 'in_progress') {
      throw new NotFoundError('AI Voice Casting is currently in progress for this chapter');
    }
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
    if (chapter.ai_casting_status === 'in_progress') {
      throw new NotFoundError('AI Voice Casting is currently in progress for this chapter');
    }
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

  async getHLSPlaylist({ chapterId, clientId, userId, queryParams = {} }) {
    const chapter = await firestoreStore.getChapter(chapterId);
    if (!chapter) throw new NotFoundError('Chapter not found');
    if (chapter.ai_casting_status === 'in_progress') {
      throw new NotFoundError('AI Voice Casting is currently in progress for this chapter');
    }
    const title = await firestoreStore.getTitle(chapter.title_id, clientId, userId) || await firestoreStore.getTitleById(chapter.title_id);
    if (!title) throw new ForbiddenError('Forbidden');

    const sections = await firestoreStore.getSections(chapterId, 0);
    if (!sections || sections.length === 0) {
      throw new NotFoundError('No sections found for chapter');
    }

    const queryParts = [];
    if (queryParams.token) queryParts.push(`token=${encodeURIComponent(queryParams.token)}`);
    if (queryParams.client_id) queryParts.push(`client_id=${encodeURIComponent(queryParams.client_id)}`);
    const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

    let maxDuration = 1;
    const items = [];

    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      let dur = s.estimated_duration;
      if (dur == null || isNaN(dur) || dur <= 0) {
        const spokenText = (s.content || '').replace(/<[^>]*>/g, '').trim();
        dur = spokenText.length > 0 ? spokenText.length / 14.5 + 0.5 : 0.5;
      }
      if (dur > maxDuration) maxDuration = dur;

      items.push(`#EXTINF:${dur.toFixed(3)},\nsegment/${i}${queryString}`);
    }

    const targetDuration = Math.max(1, Math.ceil(maxDuration));
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${targetDuration}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      ...items,
      '#EXT-X-ENDLIST',
      ''
    ].join('\n');

    return playlist;
  }

  async streamHLSSegment({ chapterId, sectionIndex, clientId, userId }) {
    const chapter = await firestoreStore.getChapter(chapterId);
    if (!chapter) throw new NotFoundError('Chapter not found');
    if (chapter.ai_casting_status === 'in_progress') {
      throw new NotFoundError('AI Voice Casting is currently in progress for this chapter');
    }
    const title = await firestoreStore.getTitle(chapter.title_id, clientId, userId) || await firestoreStore.getTitleById(chapter.title_id);
    if (!title) throw new ForbiddenError('Forbidden');

    const sections = await firestoreStore.getSections(chapterId, 0);
    const idx = parseInt(sectionIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= sections.length) {
      throw new NotFoundError('Section index out of bounds');
    }

    const section = sections[idx];
    const audioBuffer = audioFileStore.readSectionAudio(section.id)
      || await synthesizeAndCacheSection(title, chapter, section);

    return audioBuffer;
  }
}

module.exports = new ChapterController();

