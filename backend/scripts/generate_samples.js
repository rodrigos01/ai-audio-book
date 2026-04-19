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
    { id: 'en-US-Chirp3-HD-Achernar', name: 'Ashley' },
    { id: 'en-US-Chirp3-HD-Achird', name: 'Adam' },
    { id: 'en-US-Chirp3-HD-Algenib', name: 'Alex' },
    { id: 'en-US-Chirp3-HD-Algieba', name: 'Albert' },
    { id: 'en-US-Chirp3-HD-Alnilam', name: 'Alan' },
    { id: 'en-US-Chirp3-HD-Aoede', name: 'Aria' },
    { id: 'en-US-Chirp3-HD-Autonoe', name: 'Audrey' },
    { id: 'en-US-Chirp3-HD-Callirrhoe', name: 'Chloe' },
    { id: 'en-US-Chirp3-HD-Charon', name: 'Charles' },
    { id: 'en-US-Chirp3-HD-Despina', name: 'Diana' },
    { id: 'en-US-Chirp3-HD-Enceladus', name: 'Edward' },
    { id: 'en-US-Chirp3-HD-Erinome', name: 'Erica' },
    { id: 'en-US-Chirp3-HD-Fenrir', name: 'Finn' },
    { id: 'en-US-Chirp3-HD-Gacrux', name: 'Grace' },
    { id: 'en-US-Chirp3-HD-Iapetus', name: 'Isaac' },
    { id: 'en-US-Chirp3-HD-Kore', name: 'Katie' },
    { id: 'en-US-Chirp3-HD-Laomedeia', name: 'Laura' },
    { id: 'en-US-Chirp3-HD-Leda', name: 'Linda' },
    { id: 'en-US-Chirp3-HD-Orus', name: 'Oscar' },
    { id: 'en-US-Chirp3-HD-Puck', name: 'Peter' },
    { id: 'en-US-Chirp3-HD-Pulcherrima', name: 'Penny' },
    { id: 'en-US-Chirp3-HD-Rasalgethi', name: 'Robert' },
    { id: 'en-US-Chirp3-HD-Sadachbia', name: 'Sam' },
    { id: 'en-US-Chirp3-HD-Sadaltager', name: 'Simon' },
    { id: 'en-US-Chirp3-HD-Schedar', name: 'Steve' },
    { id: 'en-US-Chirp3-HD-Sulafat', name: 'Sarah' },
    { id: 'en-US-Chirp3-HD-Umbriel', name: 'Victor' },
    { id: 'en-US-Chirp3-HD-Vindemiatrix', name: 'Vanessa' },
    { id: 'en-US-Chirp3-HD-Zephyr', name: 'Zoe' },
    { id: 'en-US-Chirp3-HD-Zubenelgenubi', name: 'Zach' }
  ];

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
