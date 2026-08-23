const LocalAudioStore = require('./LocalAudioStore');
const GcsAudioStore = require('./GcsAudioStore');

// AUDIO_STORE_DRIVER=gcs switches to signed GCS URLs for segment delivery
// (see GcsAudioStore); defaults to proxying through the app (LocalAudioStore).
const driver = (process.env.AUDIO_STORE_DRIVER || 'local').toLowerCase();

module.exports = driver === 'gcs' ? new GcsAudioStore() : new LocalAudioStore();
