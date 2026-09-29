const { GoogleGenAI } = require("@google/genai");

// Casting + script generation for Gemini 3.8 TTS.
//
// Phase 1 identifies characters and decides, for each, whether it is a NAMED
// character (gets a custom Voice Design voice, described here) or a SUPPORTING
// one (gets a Voice Library voice, matched later from the description).
// Phase 2 rewrites the chapter as a `Speaker: text` script the splitter and TTS
// layer consume (see scriptText.js).
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
            1. **Casting**: Identifying all characters and describing a distinct, fitting voice for each.
            2. **Script Generation**: Restructuring text into a script for a voice performer.

            Core Principles:
            - **Consistency**: Always reuse existing characters exactly as they are already cast.
        `;

        this.modelConfig = {
            model: "gemini-3.8-flash",
            systemInstruction,
        };
    }

    async analyzeChapter(chapterText, options = {}) {
        const {
            existingVoices = {},
            language = 'English',
            skipScriptGeneration = false,
            hasNarratorVoice = false,
        } = options;

        if (!process.env.GEMINI_API_KEY) {
            throw new Error("Gemini API key is missing. Please configure it in your environment.");
        }

        const currentCastLines = Object.entries(existingVoices).map(([name, v]) =>
            `${name}: kind=${v.kind || 'named'}, gender=${v.gender || 'unknown'}, personality="${v.personality || ''}", voice="${v.description || ''}"`
        );
        const castContext = currentCastLines.length > 0 ? currentCastLines.join('\n') : 'None';
        const narratorInstruction = hasNarratorVoice
            ? 'The narrator already has a voice chosen by the user. Do not describe one: return empty strings for "narrator_voice_description" and "narrator_gender".'
            : 'If "Narrator" is not in the current cast, describe a narrator voice. If the text is first-person narrative, the narrator is the main character: reuse that character\'s description and personality.';

        const castingPrompt = `
            ### Task: Phase 1 - Character Identification & Voice Casting
            Analyze the chapter text below and list every character who speaks in it.

            ### Current Title Cast (already cast; reuse verbatim):
            ${castContext}

            ### Instructions:
            1. Identify every character with dialogue in this chapter.
            2. Use simple, single-word names (usually first names, e.g. "Alice" instead of "Dr. Alice Smith") as the "name". Unnamed characters get a short generic role label (e.g. "Guard", "Waiter").
            3. Set "kind": "named" for every character who is referred to by a personal name in the text. Set "kind": "supporting" for characters known only by a role or description (the guard, a waiter, a stranger).
            4. For characters in the "Current Title Cast", reuse the same name, kind, gender, personality and voice description exactly. Only add characters that are new to this chapter.
            5. ${narratorInstruction}
            6. The chapter text is written in ${language}. Character names and the "personality"/"narrator_personality" descriptions must also be written in ${language}.
            7. "personality" is a succinct description of how the character speaks (e.g. "Inquisitive, articulate host with warm tone"). Include any accent or region the text gives them.
            8. "voice_description" is 2-4 sentences describing only the VOICE itself (age, pitch, timbre, pace, accent, energy) -- no biography, names, or plot. Fold in any accent or region.
            9. "gender" is one of "male", "female" or "neutral".
            10. Provide a "delivery_instruction": a single, succinct, chapter-wide directive for tone, genre and pacing (e.g. "Tense noir mystery -- slow pace, dramatic pauses").

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
                            name: { type: "string" },
                            kind: { type: "string", enum: ["named", "supporting"] },
                            gender: { type: "string", enum: ["male", "female", "neutral"] },
                            personality: { type: "string", description: "Succinct description of how this character should sound" },
                            voice_description: { type: "string", description: "2-4 sentences describing only the voice" }
                        },
                        required: ["name", "kind", "gender", "personality", "voice_description"]
                    }
                },
                narrator_gender: { type: "string" },
                narrator_personality: { type: "string", description: "Succinct description of how the narrator should sound" },
                narrator_voice_description: { type: "string", description: "2-4 sentences describing only the narrator's voice" },
                delivery_instruction: { type: "string", description: "A succinct, chapter-wide directive for tone, genre and pacing" }
            },
            required: ["updated_cast", "narrator_gender", "narrator_personality", "narrator_voice_description", "delivery_instruction"]
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

        // Only new characters produce new entries; existing ones are untouched so
        // their resolved voices (and the audio cached with them) stay stable.
        const newVoices = {};
        for (const c of castingResponse.updated_cast) {
            if (!c.name || Object.keys(existingVoices).some(k => k.toLowerCase() === c.name.toLowerCase())) continue;
            newVoices[c.name] = {
                kind: c.kind === 'supporting' ? 'supporting' : 'named',
                gender: c.gender || 'neutral',
                personality: c.personality || '',
                description: c.voice_description || '',
                origin: null,
                voiceId: null,
                fallback: false,
                hash: null,
            };
        }
        if (!hasNarratorVoice && !existingVoices.Narrator && castingResponse.narrator_voice_description) {
            newVoices.Narrator = {
                kind: 'named',
                gender: castingResponse.narrator_gender || 'neutral',
                personality: castingResponse.narrator_personality || '',
                description: castingResponse.narrator_voice_description,
                origin: null,
                voiceId: null,
                fallback: false,
                hash: null,
            };
        }

        let script = null;
        if (!skipScriptGeneration) {
            const speakerNames = [...Object.keys(existingVoices), ...Object.keys(newVoices)];
            if (!speakerNames.some(n => n.toLowerCase() === 'narrator')) speakerNames.push('Narrator');

            const scriptPrompt = `
                ### Task: Phase 2 - Multi-Speaker Script
                Rewrite the chapter text into a script for a voice performer. Make sure the entire text is included in the output.

                ### Speakers (use these exact names as the speaker label):
                ${speakerNames.join(', ')}

                ### Format:
                1. Put every speaker turn on its own single line: "Speaker: text". Never break a turn across lines. Narration is "Narrator: text".
                2. Never start a line, or a sentence inside a line, with a "Word:" phrase that could be mistaken for a speaker label. Use a dash instead.
                3. Strip short dialogue attributions ("[pronoun] said.") ONLY IF they don't add visual or explanatory context to the scene.
                4. For a sustained delivery (whispering, sarcastic, deadpan, shouting), begin the turn's text with a short cue in parentheses, e.g. "Marlow: (whispering) Come closer." Omit the cue for normal speech. A cue describes delivery only -- never age, name, backstory or accent.
                5. For a single non-verbal human vocalization, put a tag inline: <laugh>, <chuckle>, <sigh>, <gasp>, <groan>, <throat-clearing>, <short pause>, <long pause>. No sound effects. No markdown or other symbols.
                6. Every line must contain words to speak. A pure reaction is written as a tag, e.g. "Chloe: <laugh>".
                7. The chapter text is written in ${language}. Keep the script -- including any cues -- in ${language}. Do not translate it.
                8. Keep any single turn under roughly 250 words; split a longer passage into consecutive turns by the same speaker.

                ### Chapter Text:
                ${chapterText}
            `;

            const scriptResult = await this.genAI.models.generateContent({
                ...this.modelConfig,
                contents: scriptPrompt,
            });
            script = scriptResult.text;
        }

        return {
            new_voices: newVoices,
            narrator_personality: castingResponse.narrator_personality || null,
            script,
            delivery_instruction: castingResponse.delivery_instruction || null,
        };
    }
}

module.exports = new AICastingService();
