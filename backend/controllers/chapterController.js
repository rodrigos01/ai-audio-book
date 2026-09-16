const firestoreStore = require('../stores/firestoreStore');
const audioStore = require('../stores/audioStore');
const { breakContentIntoSections, splitSSMLIntoSections, buildSectionItems } = require('../services/textSplitterService');
const { deleteChapterSections, synthesizeAndCacheSection } = require('../services/ttsService');
const { debugLog } = require('../services/logger');
const { NotFoundError, ForbiddenError } = require('../utils/errors');

// Observed narration pace: a ~6500-word chapter runs ~45 minutes of actual audio.
const WORDS_PER_SECOND = 6500 / (45 * 60);
// hls.js/ExoPlayer clip each segment's appended audio to the manifest's declared per-segment
// (and cumulative total) duration, silently dropping any real audio buffered past it. So no
// segment's declared #EXTINF may undershoot its actual synthesized length, and this padding
// covers whatever estimate error remains, applied once to the chapter's final segment.
const HLS_DURATION_PADDING_SECONDS = 120;

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

      if (await audioStore.readSectionAudio(section.id)) {
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

      const audioBuffer = await audioStore.readSectionAudio(section.id)
        || await synthesizeAndCacheSection(title, chapter, section);

      if (audioBuffer && onAudioChunk) {
        onAudioChunk(audioBuffer, section);
      }
    }
  }

  async getHLSPlaylist({ chapterId, clientId, userId, queryParams = {}, baseUrl }) {
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

    const durations = sections.map((s) => {
      const spokenText = (s.content || '').replace(/<[^>]*>/g, '').trim();
      const wordCount = spokenText.length > 0 ? spokenText.split(/\s+/).length : 0;

      let dur = s.estimated_duration;
      if (dur == null || isNaN(dur) || dur <= 0) {
        dur = spokenText.length > 0 ? spokenText.length / 14.5 + 0.5 : 0.5;
      }
      // The char-based estimate above runs faster than real narration for many chapters;
      // never declare less than the word-count heuristic calibrated from actual playback.
      const wordsBasedDur = wordCount / WORDS_PER_SECOND;
      return Math.max(dur, wordsBasedDur);
    });

    // Add a fixed safety margin on top of the (already word-calibrated) total so the
    // manifest's declared length still can't undershoot the real narration.
    durations[durations.length - 1] += HLS_DURATION_PADDING_SECONDS;

    const segmentUrls = await Promise.all(sections.map((s, i) =>
      audioStore.getSectionAudioUrl({ section: s, chapterId, sectionIndex: i, baseUrl, queryString })
    ));

    const items = sections.map((s, i) => `#EXTINF:${durations[i].toFixed(3)},\n${segmentUrls[i]}`);

    const targetDuration = Math.max(1, Math.ceil(Math.max(...durations)));
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
    const audioBuffer = await audioStore.readSectionAudio(section.id)
      || await synthesizeAndCacheSection(title, chapter, section);

    // The section is now guaranteed to be cached (just read or just
    // synthesized). If the store can hand back a direct delivery URL (GCS),
    // redirect there instead of proxying the bytes ourselves -- this is what
    // gets a segment off the app even when it started out as a proxy-route
    // fallback because it wasn't ready yet when the playlist was built.
    const redirectUrl = await audioStore.getDirectUrl(section.id);
    if (redirectUrl) {
      return { redirectUrl };
    }

    return { audioBuffer };
  }
}

module.exports = new ChapterController();

