// PCM (s16le, mono) -> ADTS AAC via ffmpeg. ADTS frames are self-contained, so
// segments can be byte-concatenated (the /stream route relies on this) and
// hls.js / native HLS play them as plain .aac segments with no init segment.
const { spawn } = require('child_process');
const { SAMPLE_RATE } = require('./geminiTtsClient');

const AAC_BITRATE_KBPS = 64;
const SAMPLES_PER_ADTS_FRAME = 1024;

function encodePcmToAac(pcm, sampleRate = SAMPLE_RATE, bitrateKbps = AAC_BITRATE_KBPS) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0',
      '-c:a', 'aac', '-b:a', `${bitrateKbps}k`,
      '-f', 'adts', 'pipe:1',
    ]);
    const out = [];
    let stderr = '';
    ffmpeg.stdout.on('data', d => out.push(d));
    ffmpeg.stderr.on('data', d => { stderr += d.toString(); });
    ffmpeg.on('error', err => reject(new Error(`ffmpeg failed to start (is it installed?): ${err.message}`)));
    ffmpeg.on('close', code => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
    ffmpeg.stdin.on('error', () => { /* surfaced via the close handler */ });
    ffmpeg.stdin.end(pcm);
  });
}

// Counts ADTS frames (13-bit frame length at bytes 3-5 of each header) and
// converts to seconds. Returns 0 for a buffer with no valid ADTS syncword.
function getAdtsDurationSeconds(buffer, sampleRate = SAMPLE_RATE) {
  let offset = 0;
  let frames = 0;
  while (offset + 7 <= buffer.length) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xf0) !== 0xf0) break;
    const frameLength = ((buffer[offset + 3] & 0x03) << 11) | (buffer[offset + 4] << 3) | (buffer[offset + 5] >> 5);
    if (frameLength < 7) break;
    frames += 1;
    offset += frameLength;
  }
  return (frames * SAMPLES_PER_ADTS_FRAME) / sampleRate;
}

// A short silent clip, used as a transient stand-in when synthesis fails.
function generateSilentAac(seconds = 1) {
  return encodePcmToAac(Buffer.alloc(Math.round(seconds * SAMPLE_RATE) * 2));
}

module.exports = { encodePcmToAac, getAdtsDurationSeconds, generateSilentAac };
