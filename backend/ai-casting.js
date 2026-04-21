const { GoogleGenAI } = require("@google/genai");
const fs = require('fs');
const path = require('path');
const z = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');

class AICastingService {
    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.warn("GEMINI_API_KEY not set. AI Casting will not work.");
        }
        this.genAI = new GoogleGenAI({ apiKey: apiKey });

        // General instructions moved to System Instruction
        const systemInstruction = `
            You are the "AI Casting Director" for a premium audiobook platform.
            Your goal is to transform written text into a dramatic, multi-speaker audio experience.
            
            You work in two primary capacities:
            1. **Casting**: Identifying all characters and assigning them consistent, stylistically appropriate voices.
            2. **SSML Generation**: Restructuring text for dramatic flow, stripping unnecessary attributions (like "he said"), and formatting with proper <voice> and <p> tags.
            
            Core Principles:
            - **Consistency**: Always reuse existing character-to-voice mappings.
            - **Drama**: Prioritize immersive performance over literal word-for-word transcription.
            - **Structure**: Always use paragraph (<p>) tags as the primary container for text.
        `;

        this.modelConfig = {
            model: "gemini-3.1-flash-lite-preview",
            systemInstruction,
        };
    }

    async analyzeChapter(chapterText, existingCast = {}, voiceList = []) {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("Gemini API key is missing. Please configure it in your environment.");
        }

        const availableVoices = voiceList.map(v => ({
            id: v.id,
            gender: v.gender,
            description: v.description,
            style: v.style,
        }));

        // Phase 1: Casting
        const castingPrompt = `
            ### Task: Phase 1 - Character Identification & Casting
            Analyze the chapter text below and provide an updated casting map.

            ### Available Voices:
            ${JSON.stringify(availableVoices, null, 2)}

            ### Current Title Cast:
            ${JSON.stringify(existingCast, null, 2)}

            ### Instructions:
            1. Identify every character with dialogue in this chapter.
            2. For characters in the "Current Title Cast", you MUST reuse their assigned voice ID.
            3. For new characters, assign a voice from the "Available Voices" that matches their characteristics, personality, and gender.
            4. Assign a Narrator voice. ONLY if the content is NOT a first person narrative, select a voice from the "Available Voices". Otherwise, use the same voice as the main character.

            ### Chapter Text:
            ${chapterText}
        `;

        const castingSchema = z.object({
            updated_cast: z.record(z.string(), z.string().describe("The ID of the voice to use for this character. It must be the actual ID value from the available voices list.")),
            narrator_voice: z.string().describe("The ID of the voice to use for the narrator. It must be the actual ID value from the available voices list."),
        });

        const castingResult = await this.genAI.models.generateContent({
            ...this.modelConfig,
            config: {
                responseMimeType: "application/json",
                responseSchema: zodToJsonSchema(castingSchema),
            },
            contents: castingPrompt,
        });
        const castingResponse = castingSchema.parse(JSON.parse(castingResult.text));
        const updatedCast = castingResponse.updated_cast;

        // Phase 2: SSML Generation
        const ssmlPrompt = `
            ### Task: Phase 2 - SSML Generation & Dramatic Rewriting
            Using the provided casting map, rewrite the chapter text into a high-quality SSML script.

            ### Casting Map to Use:
            ${JSON.stringify(updatedCast, null, 2)}

            ### Instructions:
            1. Wrap the entire output in <speak> tags.
            2. Use <p> tags for every paragraph.
            3. Use <voice name="VOICE_ID"> for ALL dialogue, where VOICE_ID is the ID of the voice from the casting map.
            4. Strip short dialogue attributions ("[pronoun] said.") ONLY IF they don't add visual or explanatory context to the scene
            5. Each <voice> tag must be contained WITHIN a <p> tag. Do not span <voice> tags across multiple paragraphs.

            ### Chapter Text:
            ${chapterText}
        `;

        const ssmlSchema = z.object({
            ssml: z.string(),
        });

        const ssmlResult = await this.genAI.models.generateContent({
            ...this.modelConfig,
            config: {
                responseMimeType: "application/json",
                responseSchema: zodToJsonSchema(ssmlSchema),
            },
            contents: ssmlPrompt,
        });
        const ssmlResponse = ssmlSchema.parse(JSON.parse(ssmlResult.text));

        return {
            updated_cast: updatedCast,
            ssml: ssmlResponse.ssml,
            narrator_voice: castingResponse.narrator_voice,
        };
    }
}

module.exports = new AICastingService();
