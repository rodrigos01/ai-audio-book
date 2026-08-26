const { Storage } = require('@google-cloud/storage');
const { debugLog } = require('../../services/logger');

const SIGNED_URL_TTL_MS = 60 * 60 * 1000;

class GcsAudioStore {
  constructor() {
    const bucketName = process.env.AUDIO_STORE_BUCKET;
    if (!bucketName) {
      throw new Error('AUDIO_STORE_BUCKET must be set when AUDIO_STORE_DRIVER=gcs');
    }
    this.storage = new Storage();
    this.bucket = this.storage.bucket(bucketName);
    // Matches the layout audio files already have today under the FUSE-mounted
    // bucket (STORAGE_BASE_PATH/audio_files/{sectionId}.mp3), so switching this
    // driver on doesn't orphan anything already cached.
    this.audioPrefix = 'audio_files';
  }

  getSectionObjectKey(sectionId) {
    return `${this.audioPrefix}/${sectionId}.mp3`;
  }

  async readSectionAudio(sectionId) {
    const file = this.bucket.file(this.getSectionObjectKey(sectionId));
    try {
      const [exists] = await file.exists();
      if (!exists) return null;
      const [buffer] = await file.download();
      return buffer;
    } catch (e) {
      debugLog(`Error reading cached audio for ${sectionId} from GCS, regenerating: ${e.message}`);
      return null;
    }
  }

  async saveSectionAudio(sectionId, audioBuffer) {
    const key = this.getSectionObjectKey(sectionId);
    const file = this.bucket.file(key);
    await file.save(audioBuffer, { contentType: 'audio/mpeg', resumable: false });
    return `gs://${this.bucket.name}/${key}`;
  }

  async deleteSectionAudio(sectionId) {
    const file = this.bucket.file(this.getSectionObjectKey(sectionId));
    try {
      await file.delete();
    } catch (e) {
      if (e.code !== 404) {
        debugLog(`Error deleting audio file for ${sectionId} from GCS: ${e.message}`);
      }
    }
  }

  // Signed URLs point straight at GCS, bypassing the app -- which also means
  // bypassing streamHLSSegment's lazy "synthesize on first request" fallback.
  // So a section that hasn't been synthesized yet has no object to sign a URL
  // for; fall back to the app's own proxy route (same shape LocalAudioStore
  // always returns) so it still gets generated on first play. Once a section
  // is cached, later playlist requests get the direct, app-bypassing URL.
  // Requires the runtime service account to hold roles/iam.serviceAccountTokenCreator
  // on itself (V4 signing on Cloud Run goes through the IAM signBlob API since
  // there's no local private key).
  async getSectionAudioUrl({ section, chapterId, sectionIndex, baseUrl, queryString = '' }) {
    const file = this.bucket.file(this.getSectionObjectKey(section.id));
    const [exists] = await file.exists();
    if (!exists) {
      return `${baseUrl}/api/chapters/${chapterId}/hls/segment/${sectionIndex}${queryString}`;
    }

    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return url;
  }
}

module.exports = GcsAudioStore;
