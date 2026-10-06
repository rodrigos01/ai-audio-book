const gemini = require('../services/geminiTtsClient');
const { getLanguageCode } = require('../services/languageCodes');

// The Voice Library (Gemini prebuilt voices), used by the voice picker.
class VoiceController {
  async getVoices({ language, gender, accent }) {
    const languageCode = getLanguageCode(language);
    const normalizedGender = ['male', 'female', 'neutral'].includes((gender || '').toLowerCase())
      ? gender.toLowerCase()
      : undefined;
    const voices = await gemini.listLibraryVoices({ languageCode, gender: normalizedGender, accent, pageSize: 1000 });
    return voices.map(v => ({
      id: v.id,
      name: v.name,
      gender: v.raw.gender || null,
      accent: v.raw.accent || null,
      persona: v.raw.persona || null,
      pitch: v.raw.pitch || null,
      description: v.raw.description || null,
      lang: v.raw.language_code || languageCode,
    }));
  }
}

module.exports = new VoiceController();
