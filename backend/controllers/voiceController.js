const VOICES = require('../voices.json');

class VoiceController {
  getVoices({ tierFilter }) {
    let filtered = VOICES;
    if (tierFilter) {
      filtered = VOICES.filter(v => v.tier === tierFilter || (!v.tier && tierFilter === 'basic'));
    }
    return filtered.map(v => ({
      ...v,
      lang: 'en-US',
      sampleUrl: `/samples/${v.id}.mp3`
    }));
  }
}

module.exports = new VoiceController();
