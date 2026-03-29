const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const path = require('path');

async function generateSamples() {
  const keyPath = path.join(__dirname, '../ai-audio-book-36e0611138d4.json');
  let client;
  if (fs.existsSync(keyPath)) {
    client = new textToSpeech.TextToSpeechClient({ keyFilename: keyPath });
    console.log('Using local key file for authentication');
  } else {
    client = new textToSpeech.TextToSpeechClient();
    console.log('Using Application Default Credentials');
  }
  
  const samplesDir = path.join(__dirname, '../samples');
  if (!fs.existsSync(samplesDir)) {
    fs.mkdirSync(samplesDir, { recursive: true });
  }

  const VOICES = [
    { id: 'en-US-Chirp3-HD-Aoede', name: 'Aria' },
    { id: 'en-US-Chirp3-HD-Kore', name: 'Kore' },
    { id: 'en-US-Chirp3-HD-Leda', name: 'Leda' },
    { id: 'en-US-Chirp3-HD-Charon', name: 'Charon' },
    { id: 'en-US-Chirp3-HD-Fenrir', name: 'Finn' },
    { id: 'en-US-Chirp3-HD-Orus', name: 'Oscar' }
  ];

  const sampleText = "Hello, I am one of the new high-definition voices. I can narrate your books with natural prosody and emotion.";

  for (const voice of VOICES) {
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
