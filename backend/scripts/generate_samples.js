const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const path = require('path');

async function generateSamples() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../ai-audio-book-key.json');
  let client;
  if (fs.existsSync(keyPath)) {
    client = new textToSpeech.TextToSpeechClient({ keyFilename: keyPath });
    console.log(`Using key file for authentication: ${keyPath}`);
  } else {
    client = new textToSpeech.TextToSpeechClient();
    console.log('Using Application Default Credentials');
  }
  
  const STORAGE_BASE_PATH = path.resolve(process.env.STORAGE_BASE_PATH || path.join(__dirname, '..'));
  const samplesDir = path.join(STORAGE_BASE_PATH, 'samples');
  if (!fs.existsSync(samplesDir)) {
    fs.mkdirSync(samplesDir, { recursive: true });
  }

  const VOICES = require('../voices.json');

  for (const voice of VOICES) {
    const outputFile = path.join(samplesDir, `${voice.id}.mp3`);
    if (fs.existsSync(outputFile)) {
      console.log(`Skipping ${voice.name} (${voice.id}), sample already exists.`);
      continue;
    }

    const sampleText = `Hello, I am ${voice.name}. I will be your narrator for this audiobook. I hope you enjoy the story!`;
    console.log(`Generating sample for ${voice.name} (${voice.id})...`);
    const request = {
      input: { text: sampleText },
      voice: { languageCode: 'en-US', name: voice.id },
      audioConfig: { audioEncoding: 'MP3' },
    };

    try {
      const [response] = await client.synthesizeSpeech(request);
      const outputFile = path.join(samplesDir, `${voice.id}.mp3`);
      fs.writeFileSync(outputFile, response.audioContent, 'binary');
      console.log(`Saved sample to ${outputFile}`);
    } catch (e) {
      console.error(`Failed to generate sample for ${voice.name}:`, e.message);
    }
  }
}

generateSamples().catch(console.error);
