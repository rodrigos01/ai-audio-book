// Human-readable title.language -> BCP-47 code for Gemini TTS voices.
// Missing/unrecognized languages fall back to 'en-US'.
const LANGUAGE_CODES = {
  'English': 'en-US',
  'Spanish': 'es-US',
  'French': 'fr-FR',
  'German': 'de-DE',
  'Italian': 'it-IT',
  'Portuguese': 'pt-BR',
  'Dutch': 'nl-NL',
  'Russian': 'ru-RU',
  'Japanese': 'ja-JP',
  'Korean': 'ko-KR',
  'Chinese': 'cmn-CN',
  'Mandarin Chinese': 'cmn-CN',
  'Arabic': 'ar-XA',
  'Hindi': 'hi-IN',
  'Polish': 'pl-PL',
  'Turkish': 'tr-TR',
  'Vietnamese': 'vi-VN',
  'Thai': 'th-TH',
  'Indonesian': 'id-ID',
  'Romanian': 'ro-RO',
  'Ukrainian': 'uk-UA',
  'Bengali': 'bn-IN',
  'Tamil': 'ta-IN',
  'Telugu': 'te-IN',
  'Marathi': 'mr-IN',
};

function getLanguageCode(languageName) {
  if (!languageName) return 'en-US';
  if (LANGUAGE_CODES[languageName]) return LANGUAGE_CODES[languageName];
  const found = Object.keys(LANGUAGE_CODES).find(k => k.toLowerCase() === languageName.toLowerCase());
  return found ? LANGUAGE_CODES[found] : 'en-US';
}

module.exports = { LANGUAGE_CODES, getLanguageCode };
