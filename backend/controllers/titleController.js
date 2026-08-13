const { v4: uuidv4 } = require('uuid');
const firestoreStore = require('../stores/firestoreStore');
const aiCasting = require('../services/aiCastingService');
const googleDocsService = require('../services/googleDocsService');
const { breakContentIntoSections, splitSSMLIntoSections, splitMultiSpeakerIntoSections, buildSectionItems } = require('../services/textSplitterService');
const { deleteChapterSections } = require('../services/ttsService');
const { debugLog } = require('../services/logger');
const { ValidationError, NotFoundError, UnauthorizedError } = require('../utils/errors');
const VOICES = require('../voices.json');

class TitleController {
  async createTitle({ name, ai_casting_enabled, tts_tier, narrator_voice, clientId, userId }) {
    if (!name) throw new ValidationError('Name is required');
    const id = uuidv4();
    const tier = tts_tier === 'pro' ? 'pro' : 'basic';
    await firestoreStore.createTitle({
      id,
      name,
      ai_casting_enabled: !!ai_casting_enabled,
      tts_tier: tier,
      narrator_voice: narrator_voice || null,
      casting_map: {},
      client_id: clientId,
      user_id: userId
    });
    return { id, name, ai_casting_enabled: !!ai_casting_enabled, tts_tier: tier, narrator_voice: narrator_voice || null };
  }

  async updateTitle({ id, name, casting_map, narrator_voice, clientId, userId }) {
    const title = await firestoreStore.getTitle(id, clientId, userId);
    if (!title) throw new NotFoundError('Title not found');

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (casting_map !== undefined) updateData.casting_map = casting_map;
    if (narrator_voice !== undefined) updateData.narrator_voice = narrator_voice;

    await firestoreStore.updateTitle(id, updateData);

    if (casting_map !== undefined) {
      const oldMap = title.casting_map || {};
      const newMap = casting_map;

      const changedCharacters = Object.keys(newMap).filter(char => oldMap[char] !== newMap[char]);

      if (changedCharacters.length > 0) {
        debugLog(`Voice change detected for characters: ${changedCharacters.join(', ')}`);
        const chapters = await firestoreStore.getChapters(id);
        for (const ch of chapters) {
          if (ch.is_ssml) {
            let updated = false;
            let currentSSML = ch.content;

            changedCharacters.forEach(char => {
              const oldVoice = oldMap[char];
              const newVoice = newMap[char];
              if (oldVoice && currentSSML.includes(oldVoice)) {
                currentSSML = currentSSML.replaceAll(oldVoice, newVoice);
                updated = true;
              }
            });

            if (updated) {
              debugLog(`Propagating voice change to chapter ${ch.id}`);
              await firestoreStore.updateChapter(ch.id, { content: currentSSML });
              await deleteChapterSections(ch.id);

              const newSections = splitSSMLIntoSections(currentSSML);
              const sectionData = buildSectionItems(ch.id, newSections);
              await firestoreStore.insertSections(sectionData);
            }
          }
        }
      }
    }

    return { success: true };
  }

  async deleteTitle({ id, clientId, userId }) {
    const title = await firestoreStore.getTitle(id, clientId, userId);
    if (!title) throw new NotFoundError('Title not found');
    await firestoreStore.deleteTitle(id);
    return { success: true };
  }

  async claimTitles({ clientId, userId }) {
    if (!userId) throw new UnauthorizedError('Must be logged in to claim books');
    const count = await firestoreStore.linkAnonymousTitles(clientId, userId);
    return { success: true, claimed_count: count };
  }

  async addChapter({ titleId, content, voice_id, name, google_doc_id, google_access_token, clientId, userId }) {
    let finalContent = content;
    let finalName = name;

    if (!finalContent && google_doc_id && google_access_token) {
      try {
        const docResult = await googleDocsService.fetchDocumentText(google_doc_id, google_access_token);
        finalContent = docResult.content;
        if (!finalName && docResult.title) {
          finalName = docResult.title;
        }
      } catch (docErr) {
        throw new ValidationError('Failed to fetch Google Document: ' + docErr.message);
      }
    }

    if (!finalContent) throw new ValidationError('Content is required');

    const title = await firestoreStore.getTitle(titleId, clientId, userId);
    if (!title) throw new NotFoundError('Title not found');

    const maxOrder = await firestoreStore.getMaxChapterOrder(titleId);
    const orderIndex = maxOrder + 1;
    const voiceId = voice_id || title.narrator_voice || 'en-US-Chirp3-HD-Aoede';
    const isAiCasting = !!title.ai_casting_enabled;
    const chapterId = uuidv4();

    await firestoreStore.createChapter({
      id: chapterId,
      title_id: titleId,
      order_index: orderIndex,
      content: finalContent,
      voice_id: voiceId,
      is_ssml: false,
      performance_prompt: null,
      name: finalName || null,
      ai_casting_status: isAiCasting ? 'in_progress' : null
    });

    if (isAiCasting) {
      this._processAiCastingInBackground({ chapterId, titleId, finalContent, title }).catch(err => {
        debugLog(`Unhandled background AI casting error for chapter ${chapterId}: ${err.message}`);
      });
      return { id: chapterId, title_id: titleId, order_index: orderIndex, name: finalName || null, ai_casting_status: 'in_progress' };
    }

    const sections = title.tts_tier === 'pro'
      ? splitMultiSpeakerIntoSections(finalContent)
      : breakContentIntoSections(finalContent);
    const sectionItems = buildSectionItems(chapterId, sections);
    await firestoreStore.insertSections(sectionItems);

    return { id: chapterId, title_id: titleId, order_index: orderIndex, name: finalName || null, ai_casting_status: null };
  }

  async _processAiCastingInBackground({ chapterId, titleId, finalContent, title }) {
    try {
      const tier = title.tts_tier || 'basic';
      debugLog(`AI Casting background (${tier}): Auto-casting new chapter ${chapterId} for ${title.name}`);
      const existingCast = title.casting_map || {};
      const existingNarrator = title.narrator_voice || null;

      const result = await aiCasting.analyzeChapter(finalContent, existingCast, VOICES, existingNarrator, tier);

      const titleUpdate = { casting_map: result.updated_cast };
      if (!title.narrator_voice) titleUpdate.narrator_voice = result.narrator_voice;
      if (!title.narrator_personality && result.narrator_personality) titleUpdate.narrator_personality = result.narrator_personality;

      if (result.character_personalities) {
        titleUpdate.character_personalities = {
          ...(title.character_personalities || {}),
          ...result.character_personalities
        };
      }
      await firestoreStore.updateTitle(titleId, titleUpdate);

      const processedContent = result.ssml;
      const voiceId = result.narrator_voice;
      const isSSML = tier === 'basic';
      const performancePrompt = result.performance_prompt || null;

      await firestoreStore.updateChapter(chapterId, {
        content: processedContent,
        voice_id: voiceId,
        is_ssml: isSSML,
        performance_prompt: performancePrompt,
        ai_casting_status: 'completed'
      });

      const sections = isSSML
        ? splitSSMLIntoSections(processedContent)
        : (tier === 'pro' ? splitMultiSpeakerIntoSections(processedContent) : breakContentIntoSections(processedContent));
      const sectionItems = buildSectionItems(chapterId, sections);
      await firestoreStore.insertSections(sectionItems);

      debugLog(`AI Casting background completed successfully for chapter ${chapterId}`);
    } catch (castError) {
      debugLog(`Auto-casting background failed for chapter ${chapterId}, falling back to standard: ${castError.message}`);
      const tier = title.tts_tier || 'basic';
      const sections = tier === 'pro' ? splitMultiSpeakerIntoSections(finalContent) : breakContentIntoSections(finalContent);
      const sectionItems = buildSectionItems(chapterId, sections);
      await firestoreStore.insertSections(sectionItems);

      await firestoreStore.updateChapter(chapterId, {
        ai_casting_status: 'failed'
      });
    }
  }
}

module.exports = new TitleController();
