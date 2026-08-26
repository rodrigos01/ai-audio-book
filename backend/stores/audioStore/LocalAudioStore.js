const fs = require('fs');
const path = require('path');
const { debugLog } = require('../../services/logger');

class LocalAudioStore {
  constructor() {
    this.storageBasePath = path.resolve(process.env.STORAGE_BASE_PATH || path.resolve(__dirname, '../..'));
    this.audioDir = path.join(this.storageBasePath, 'audio_files');
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
    }
  }

  getSectionAudioPath(sectionId) {
    return path.join(this.audioDir, `${sectionId}.mp3`);
  }

  async readSectionAudio(sectionId) {
    const localPath = this.getSectionAudioPath(sectionId);
    if (!fs.existsSync(localPath)) return null;
    try {
      return fs.readFileSync(localPath);
    } catch (e) {
      debugLog(`Error reading cached audio for ${sectionId}, regenerating: ${e.message}`);
      return null;
    }
  }

  async saveSectionAudio(sectionId, audioBuffer) {
    const localPath = this.getSectionAudioPath(sectionId);
    fs.writeFileSync(localPath, audioBuffer);
    return localPath;
  }

  async deleteSectionAudio(sectionId) {
    const localPath = this.getSectionAudioPath(sectionId);
    if (fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
      } catch (e) {
        debugLog(`Error deleting audio file for ${sectionId}: ${e.message}`);
      }
    }
  }

  // Local mode still proxies bytes through the existing HLS segment route
  // (see chapterRoutes.js) rather than serving a file directly, so the URL
  // just needs to be that route's own address, made absolute.
  async getSectionAudioUrl({ chapterId, sectionIndex, baseUrl, queryString = '' }) {
    return `${baseUrl}/api/chapters/${chapterId}/hls/segment/${sectionIndex}${queryString}`;
  }

  // There's no separate delivery URL to hand back here -- the proxy route
  // above IS how local mode serves bytes, so streamHLSSegment should just
  // stream them itself rather than redirect.
  async getDirectUrl() {
    return null;
  }
}

module.exports = LocalAudioStore;
