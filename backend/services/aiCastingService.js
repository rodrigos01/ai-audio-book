const { GoogleGenAI } = require("@google/genai");

class AICastingService {
    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.warn("GEMINI_API_KEY not set. AI Casting will not work.");
        }
        this.genAI = new GoogleGenAI({ apiKey: apiKey });

        const systemInstruction = `
            You are the "AI Director" for a premium audiobook platform.
            Your goal is to transform written text into a dramatic, multi-speaker audio experience.
            
            You work in two primary capacities:
            1. **Casting**: Identifying all characters and assigning them consistent, stylistically appropriate voices.
            2. **Script Generation**: Restructuring text for dramatic flow.
            
            Core Principles:
            - **Consistency**: Always reuse existing character-to-voice mappings.
        `;

        this.modelConfig = {
            model: "gemini-3.6-flash",
            systemInstruction,
        };
    }

    async analyzeChapter(chapterText, existingCast = {}, voiceList = [], existingNarrator = null, tier = 'basic') {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("Gemini API key is missing. Please configure it in your environment.");
        }

        const filteredVoices = voiceList.filter(v => {
            if (tier === 'pro') return v.tier === 'pro';
            return v.tier === 'basic' || !v.tier;
        });
        const voicesToUse = filteredVoices.length > 0 ? filteredVoices : voiceList;

        const availableVoices = voicesToUse.map(v => ({
            id: v.id,
            gender: v.gender,
            description: v.description,
            style: v.style,
        }));

        const currentCastString = Object.keys(existingCast).map(k => `${k}: ${existingCast[k]}`).join('\n');
        const castContext = existingNarrator
            ? `${currentCastString}\nNarrator: ${existingNarrator}`
            : currentCastString;

        const castingPrompt = `
            ### Task: Phase 1 - Character Identification & Casting
            Analyze the chapter text below and provide an updated casting map.

            ### Available Voices:
            ${JSON.stringify(availableVoices, null, 2)}

            ### Current Title Cast:
            ${castContext}

            ### Instructions:
            1. Identify every character with dialogue in this chapter.
            2. Use simple, single-word names (usually first names, e.g. "Alice" instead of "Dr. Alice Smith", "Kerem" instead of "Kerem Al-Mansoor", "Desmond" instead of "Desmond Vance") for character names in the casting map.
            3. For characters in the "Current Title Cast", you MUST reuse their assigned voice ID.
            4. For new characters, assign a voice from the "Available Voices" that matches their characteristics, personality, and gender.
                - DO NOT assign the same voice to multiple characters.
            5. Assign a Narrator voice, if one was not assigned yet. If the text is a first-person narrative, use the same voice as the main character.
            7. For each character and the Narrator, provide a succinct description of how they should sound (e.g. "Inquisitive, articulate host with warm tone", "Calm, steady storyteller with gentle warmth") in the "personality" and "narrator_personality" fields. If a character is described as having a specific accent, or as coming from a specific region, include that in the personality description. If the narrator is the main charachter, they should have identical personalities.

            ### Chapter Text:
            ${chapterText}
        `;

        const castingSchema = {
            type: "object",
            properties: {
                updated_cast: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: {
                                type: "string"
                            },
                            voice_id: {
                                type: "string"
                            },
                            personality: {
                                type: "string",
                                description: "Succinct description of how this character should sound"
                            }
                        },
                        required: ["name", "voice_id", "personality"]
                    }
                },
                narrator_voice: {
                    type: "string"
                },
                narrator_personality: {
                    type: "string",
                    description: "Succinct description of how the narrator should sound"
                }
            },
            required: ["updated_cast", "narrator_voice", "narrator_personality"]
        };

        const castingResult = await this.genAI.models.generateContent({
            ...this.modelConfig,
            config: {
                responseMimeType: "application/json",
                responseSchema: castingSchema,
            },
            contents: castingPrompt,
        });
        const castingResponse = JSON.parse(castingResult.text);
        const updatedCast = castingResponse.updated_cast.reduce((acc, { name, voice_id }) => {
            acc[name] = voice_id;
            return acc;
        }, {});

        const characterPersonalities = castingResponse.updated_cast.reduce((acc, { name, personality }) => {
            if (personality) acc[name] = personality;
            return acc;
        }, {});

        let formattedOutput = '';
        let performancePrompt = null;

        if (tier === 'pro') {
            const proPrompt = `
                ### Task: Phase 2 - Natural Language Multi-Speaker Script
                Using the provided casting map, rewrite the chapter text into a Gemini-TTS-optimised multi-speaker script. Make sure the entire text is included in the output.

                ### Casting Map to Use:
                ${JSON.stringify(updatedCast, null, 2)}

                ### Instructions:
                1. Format every speaker turn on a NEW line starting with "SpeakerAlias: Dialogue". The narrator is also a speaker, so narration should be formatted as "Narrator: Dialogue".
                2. Use the character names from the casting map as the SpeakerAlias.
                3. Strip short dialogue attributions ("[pronoun] said.") ONLY IF they don't add visual or explanatory context to the scene.
                4. Add acting queues in parentheses for any non-verbal sounds, actions, or emotions that should be conveyed in the audio performance (e.g. "(sighs)", "(laughs)", "(angrily)").

                ### Chapter Text:
                ${chapterText}
            `;

            const proSchema = {
                type: "object",
                properties: {
                    performance_prompt: {
                        type: "string",
                        description: "Tailored natural language performance prompt describing the vocal style, tone, pace, and mood for this chapter."
                    },
                    script: {
                        type: "string",
                        description: "The formatted natural language multi-speaker script text with SpeakerAlias: Dialogue lines."
                    }
                },
                required: ["performance_prompt", "script"]
            };

            const proResult = await this.genAI.models.generateContent({
                ...this.modelConfig,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: proSchema,
                },
                contents: proPrompt,
            });
            const proParsed = JSON.parse(proResult.text);
            formattedOutput = proParsed.script;
            performancePrompt = proParsed.performance_prompt;
        } else {
            const ssmlPrompt = `
                ### Task: Phase 2 - SSML Generation & Dramatic Rewriting
                Using the provided casting map, rewrite the chapter text into a high-quality SSML script. Make sure the entire text is included in the SSML output

                ### Casting Map to Use:
                ${JSON.stringify(updatedCast, null, 2)}

                ### Instructions:
                1. Wrap the entire output in <speak> tags.
                2. Use <p> tags for every paragraph.
                3. Use <voice name="VOICE_ID"> for ALL dialogue, where VOICE_ID is the ID of the voice from the casting map.
                4. Strip short dialogue attributions ("[pronoun] said.") ONLY IF they don't add visual or explanatory context to the scene
                5. Each <voice> tag must be contained WITHIN a <p> tag. Do not span <voice> tags across multiple paragraphs.
                6. Identify words that require special pronunciation and wrap them in <phoneme alphabet="ipa" ph="..."> tags.

                ### Chapter Text:
                ${chapterText}
            `;

            const ssmlResult = await this.genAI.models.generateContent({
                ...this.modelConfig,
                contents: ssmlPrompt,
            });
            formattedOutput = ssmlResult.text;
        }

        return {
            updated_cast: updatedCast,
            character_personalities: characterPersonalities,
            ssml: formattedOutput,
            narrator_voice: castingResponse.narrator_voice,
            narrator_personality: castingResponse.narrator_personality || null,
            performance_prompt: performancePrompt,
        };
    }
}

module.exports = new AICastingService();
