# Gemini TTS Voice Reference

*A merged reference of the 30 prebuilt Gemini TTS voices — combining the character/trait descriptors from Google's [Gemini API speech-generation docs](https://ai.google.dev/gemini-api/docs/speech-generation#voices) with the voice gender listing from the [Cloud Text-to-Speech Gemini-TTS docs](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts#voice_options) (both CC BY 4.0).*

Use this alongside the prompting guide: pick a voice whose listed gender and character trait already line up with the character you're writing in your Audio Profile / Director's Notes, rather than fighting the voice with instructions. Gemini TTS *can* be pushed to flex outside a voice's default gender presentation, but results are noticeably less natural — a written character description that matches the voice's native gender and quality will generally sound more convincing than one that asks the model to override it.

## Voice table

| Voice | Gender | Character trait |
|---|---|---|
| Achernar | Female | Soft |
| Achird | Male | Friendly |
| Algenib | Male | Gravelly |
| Algieba | Male | Smooth |
| Alnilam | Male | Firm |
| Aoede | Female | Breezy |
| Autonoe | Female | Bright |
| Callirrhoe | Female | Easy-going |
| Charon | Male | Informative |
| Despina | Female | Smooth |
| Enceladus | Male | Breathy |
| Erinome | Female | Clear |
| Fenrir | Male | Excitable |
| Gacrux | Female | Mature |
| Iapetus | Male | Clear |
| Kore | Female | Firm |
| Laomedeia | Female | Upbeat |
| Leda | Female | Youthful |
| Orus | Male | Firm |
| Puck | Male | Upbeat |
| Pulcherrima | Female | Forward |
| Rasalgethi | Male | Informative |
| Sadachbia | Male | Lively |
| Sadaltager | Male | Knowledgeable |
| Schedar | Male | Even |
| Sulafat | Female | Warm |
| Umbriel | Male | Easy-going |
| Vindemiatrix | Female | Gentle |
| Zephyr | Female | Bright |
| Zubenelgenubi | Male | Casual |

## Quick lookup by gender

**Female:** Achernar (Soft), Aoede (Breezy), Autonoe (Bright), Callirrhoe (Easy-going), Despina (Smooth), Erinome (Clear), Gacrux (Mature), Kore (Firm), Laomedeia (Upbeat), Leda (Youthful), Pulcherrima (Forward), Sulafat (Warm), Vindemiatrix (Gentle), Zephyr (Bright)

**Male:** Achird (Friendly), Algenib (Gravelly), Algieba (Smooth), Alnilam (Firm), Charon (Informative), Enceladus (Breathy), Fenrir (Excitable), Iapetus (Clear), Orus (Firm), Puck (Upbeat), Rasalgethi (Informative), Sadachbia (Lively), Sadaltager (Knowledgeable), Schedar (Even), Umbriel (Easy-going), Zubenelgenubi (Casual)

## Notes

- Voice names are case-insensitive in most API calls, but are shown here in their standard casing.
- All 30 voices are shared across the Gemini TTS model family (Gemini 3.1 Flash TTS Preview, Gemini 2.5 Flash TTS, Gemini 2.5 Flash Lite TTS, and Gemini 2.5 Pro TTS) — gender and trait are consistent regardless of which model you're calling.
- Traits are a starting point, not a hard limit — combine a voice's natural quality with specific Director's Notes (style, pacing, accent) to shape the actual performance, as covered in the main prompting guide.