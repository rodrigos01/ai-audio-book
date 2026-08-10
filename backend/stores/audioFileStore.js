const fs = require('fs');
const path = require('path');
const { debugLog } = require('../services/logger');

class AudioFileStore {
  constructor() {
    this.storageBasePath = path.resolve(process.env.STORAGE_BASE_PATH || path.resolve(__dirname, '..'));
    this.audioDir = path.join(this.storageBasePath, 'audio_files');
    this.samplesDir = path.join(this.storageBasePath, 'samples');
    this.ensureStorageDirs();
  }

  ensureStorageDirs() {
    [this.audioDir, this.samplesDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  getSectionAudioPath(sectionId) {
    return path.join(this.audioDir, `${sectionId}.mp3`);
  }

  readSectionAudio(sectionId) {
    const localPath = this.getSectionAudioPath(sectionId);
    if (!fs.existsSync(localPath)) return null;
    try {
      return fs.readFileSync(localPath);
    } catch (e) {
      debugLog(`Error reading cached audio for ${sectionId}, regenerating: ${e.message}`);
      return null;
    }
  }

  saveSectionAudio(sectionId, audioBuffer) {
    const localPath = this.getSectionAudioPath(sectionId);
    fs.writeFileSync(localPath, audioBuffer);
    return localPath;
  }

  deleteSectionAudio(sectionId) {
    const localPath = this.getSectionAudioPath(sectionId);
    if (fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
      } catch (e) {
        debugLog(`Error deleting audio file for ${sectionId}: ${e.message}`);
      }
    }
  }
}

module.exports = new AudioFileStore();
