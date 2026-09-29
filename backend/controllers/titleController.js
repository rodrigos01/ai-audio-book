const { v4: uuidv4 } = require('uuid');
const firestoreStore = require('../stores/firestoreStore');
const aiCasting = require('../services/aiCastingService');
const googleDocsService = require('../services/googleDocsService');
const { breakContentIntoSections, splitMultiSpeakerIntoSections, buildSectionItems } = require('../services/textSplitterService');
const { deleteChapterSections, invalidateSpeakerAudio, synthesizePreview } = require('../services/ttsService');
const { resolveVoice, resolveAllVoices, releaseTitleVoices } = require('../services/voiceResolutionService');
const { cleanScript, NARRATOR } = require('../services/scriptText');
const gemini = require('../services/geminiTtsClient');
const { getLanguageCode } = require('../services/languageCodes');
const { debugLog } = require('../services/logger');
const { ValidationError, NotFoundError, UnauthorizedError } = require('../utils/errors');

// Fields of a title.voices entry a client may set directly.
const EDITABLE_VOICE_FIELDS = ['kind', 'gender', 'description', 'personality'];

class TitleController {
  async createTitle({ name, ai_casting_enabled, narrator_voice, language, clientId, userId }) {
    if (!name) throw new ValidationError('Name is required');
    const id = uuidv4();
    await firestoreStore.createTitle({
      id,
      name,
      ai_casting_enabled: !!ai_casting_enabled,
      narrator_voice: narrator_voice || null,
      language: language || 'English',
      casting_map: {},
      voices: {},
      client_id: clientId,
      user_id: userId
    });
    return { id, name, ai_casting_enabled: !!ai_casting_enabled, narrator_voice: narrator_voice || null, language: language || 'English' };
  }

  async updateTitle({ id, name, casting_map, narrator_voice, language, voices, clientId, userId }) {
    const title = await firestoreStore.getTitle(id, clientId, userId);
    if (!title) throw new NotFoundError('Title not found');

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (casting_map !== undefined) updateData.casting_map = casting_map;
    if (narrator_voice !== undefined) updateData.narrator_voice = narrator_voice;
    if (language !== undefined) updateData.language = language;
    if (Object.keys(updateData).length > 0) await firestoreStore.updateTitle(id, updateData);

    // Speakers whose voice changed: their cached audio is invalidated so it
    // re-synthesizes on next play. No script rewrite is needed -- scripts are
    // labelled by character name, not voice id.
    const changed = new Set();

    if (casting_map !== undefined) {
      const oldMap = title.casting_map || {};
      for (const char of Object.keys(casting_map)) {
        if (oldMap[char] !== casting_map[char]) changed.add(char);
      }
    }
    if (narrator_voice !== undefined && narrator_voice !== title.narrator_voice) changed.add(NARRATOR);
    if (language !== undefined && language !== title.language) {
      // Language affects every designed voice and the spoken text.
      Object.keys(title.voices || {}).forEach(k => changed.add(k));
      changed.add(NARRATOR);
    }

    if (voices) {
      for (const [charName, patch] of Object.entries(voices)) {
        const existing = (title.voices || {})[charName];
        if (!existing) throw new ValidationError(`Unknown character: ${charName}`);
        const next = { ...existing };
        let touched = false;

        for (const field of EDITABLE_VOICE_FIELDS) {
          if (patch[field] !== undefined && patch[field] !== existing[field]) {
            next[field] = patch[field];
            next.pinned = false; // description/kind edits re-resolve the voice
            touched = true;
          }
        }
        if (patch.voiceId) {
          // User picked a specific library voice: pin it.
          Object.assign(next, { voiceId: patch.voiceId, origin: 'library', pinned: true, fallback: false, hash: null });
          touched = true;
        }
        if (!touched) continue;

        // The old designed voice is no longer needed once replaced or unpinned.
        if (existing.origin === 'design' && existing.voiceId && (patch.voiceId || next.voiceId !== existing.voiceId)) {
          await gemini.deleteVoice(existing.voiceId);
        }
        if (!patch.voiceId) Object.assign(next, { voiceId: null, origin: null, hash: null });
        await firestoreStore.setTitleVoice(id, charName, next);
        changed.add(charName);
      }
    }

    if (changed.size > 0) {
      debugLog(`Voice change detected for: ${[...changed].join(', ')}`);
      const chapters = await firestoreStore.getChapters(id);
      for (const ch of chapters) {
        await invalidateSpeakerAudio(ch.id, [...changed]);
      }
      if (voices) {
        // Re-resolve edited characters now so first play isn't blocked on it.
        const fresh = await firestoreStore.getTitleById(id);
        resolveAllVoices(fresh).catch(err => debugLog(`Voice re-resolution failed: ${err.message}`));
      }
    }

    return { success: true };
  }

  async deleteTitle({ id, clientId, userId }) {
    const title = await firestoreStore.getTitle(id, clientId, userId);
    if (!title) throw new NotFoundError('Title not found');
    await firestoreStore.deleteTitle(id);
    // Designed voices count against a per-project quota; release ours.
    releaseTitleVoices(title).catch(err => debugLog(`Releasing designed voices failed: ${err.message}`));
    return { success: true };
  }

  async claimTitles({ clientId, userId }) {
    if (!userId) throw new UnauthorizedError('Must be logged in to claim books');
    const count = await firestoreStore.linkAnonymousTitles(clientId, userId);
    return { success: true, claimed_count: count };
  }

  async addChapter({ titleId, content, voice_id, name, google_doc_id, google_access_token, skip_script_generation, clientId, userId }) {
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
    const voiceId = voice_id || title.narrator_voice || null;
    const isAiCasting = !!title.ai_casting_enabled;
    const chapterId = uuidv4();

    await firestoreStore.createChapter({
      id: chapterId,
      title_id: titleId,
      order_index: orderIndex,
      content: finalContent,
      voice_id: voiceId,
      name: finalName || null,
      ai_casting_status: isAiCasting ? 'in_progress' : null
    });

    if (isAiCasting) {
      this._processAiCastingInBackground({
        chapterId,
        titleId,
        finalContent,
        title,
        skipScriptGeneration: !!skip_script_generation
      }).catch(err => {
        debugLog(`Unhandled background AI casting error for chapter ${chapterId}: ${err.message}`);
      });
      return { id: chapterId, title_id: titleId, order_index: orderIndex, name: finalName || null, ai_casting_status: 'in_progress' };
    }

    const sectionItems = buildSectionItems(chapterId, breakContentIntoSections(finalContent));
    await firestoreStore.insertSections(sectionItems);

    return { id: chapterId, title_id: titleId, order_index: orderIndex, name: finalName || null, ai_casting_status: null };
  }

  async _processAiCastingInBackground({ chapterId, titleId, finalContent, title, skipScriptGeneration = false }) {
    try {
      debugLog(`AI Casting background: Auto-casting new chapter ${chapterId} for ${title.name}${skipScriptGeneration ? ' (script generation skipped)' : ''}`);

      const result = await aiCasting.analyzeChapter(finalContent, {
        existingVoices: title.voices || {},
        language: title.language || 'English',
        skipScriptGeneration,
        hasNarratorVoice: !!title.narrator_voice,
      });

      for (const [charName, entry] of Object.entries(result.new_voices)) {
        await firestoreStore.setTitleVoice(titleId, charName, entry);
      }
      if (!title.narrator_personality && result.narrator_personality) {
        await firestoreStore.updateTitle(titleId, { narrator_personality: result.narrator_personality });
      }

      const processedContent = skipScriptGeneration ? finalContent : cleanScript(result.script);
      if (!processedContent) throw new Error('AI casting produced an empty script');

      await firestoreStore.updateChapter(chapterId, {
        content: processedContent,
        voice_id: title.narrator_voice || null,
        ai_casting_status: 'completed',
        delivery_instruction: result.delivery_instruction || null
      });

      const sectionItems = buildSectionItems(chapterId, splitMultiSpeakerIntoSections(processedContent));
      await firestoreStore.insertSections(sectionItems);

      // Resolve (design / library-match) voices now so first play isn't blocked
      // on it. Best-effort: synthesis resolves lazily if this hasn't finished.
      firestoreStore.getTitleById(titleId)
        .then(fresh => fresh && resolveAllVoices(fresh))
        .catch(err => debugLog(`Eager voice resolution failed for ${titleId}: ${err.message}`));

      debugLog(`AI Casting background completed successfully for chapter ${chapterId}`);
    } catch (castError) {
      debugLog(`Auto-casting background failed for chapter ${chapterId}, falling back to standard: ${castError.message}`);
      const sectionItems = buildSectionItems(chapterId, breakContentIntoSections(finalContent));
      await firestoreStore.insertSections(sectionItems);

      await firestoreStore.updateChapter(chapterId, {
        ai_casting_status: 'failed'
      });
    }
  }

  // Short cached sample of a character's current voice.
  async getVoicePreview({ id, name, clientId, userId }) {
    const title = await firestoreStore.getTitle(id, clientId, userId);
    if (!title) throw new NotFoundError('Title not found');
    const voice = await resolveVoice(title, name);
    return synthesizePreview({ voiceId: voice.voiceId, languageCode: voice.languageCode, name, language: title.language });
  }

  // Sample of any library voice, for the voice picker.
  async getLibraryVoicePreview({ voiceId, language }) {
    return synthesizePreview({ voiceId, languageCode: getLanguageCode(language), name: null, language });
  }
}

module.exports = new TitleController();
