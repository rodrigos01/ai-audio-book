# Gemini TTS Prompting Guide

*A reference for writing "full prompts" for Gemini's native-audio text-to-speech models. Give this file to an LLM along with a short description of the voice/scene you want, and ask it to produce a complete prompt following this structure.*

Source: adapted from Google's Gemini API documentation on [speech generation](https://ai.google.dev/gemini-api/docs/speech-generation#prompting-guide) (CC BY 4.0).

---

## The core idea

Gemini's TTS models aren't a conventional "type text, get audio" system — they're driven by a language model that reasons about **how** a line should be delivered, not just **what** it says. That means a good prompt reads less like a caption and more like a director's brief: it sets up a character, a physical scene, and specific performance notes, and then hands the actor a script to perform in that context.

Two guiding principles for anyone writing these prompts:

1. **Alignment matters.** The transcript's subject matter and phrasing should match the tone you're directing. A script about a stock market crash won't land as convincingly cheerful, no matter how many "upbeat" instructions you stack on it.
2. **Don't over-specify.** Give the model enough to understand the performance, but leave some room for it to fill in the details — an actor works better with a clear brief than a word-for-word choreography sheet.

---

## The five building blocks

A complete prompt is typically assembled from these parts. Director's Notes is the one part worth never skipping; everything else is there to add context and naturalness.

| Block | What it does |
|---|---|
| **Audio Profile** | Names the character and gives their core identity/archetype (e.g. radio host, podcaster, customer support agent). |
| **Scene** | Describes the physical location and emotional atmosphere the character is performing in — this shapes delivery indirectly, the way a real environment would. |
| **Director's Notes** | The most important section. Explicit performance guidance: style, accent, pacing, breathing, articulation — whatever matters most for this specific read. |
| **Sample Context** | A line or two establishing what kind of material this voice is typically used for, so the model understands the character's "home turf." |
| **Transcript** | The actual text to be spoken, optionally marked up with inline audio tags. |

### Audio Profile

- Give the character a name — it helps the model tie identity to performance, and lets you refer back to them consistently.
- State their role/archetype in a few words (e.g. "morning radio DJ," "beauty influencer," "noir detective narrating a case file").

### Scene

- Set location, time, and mood.
- Describe what's physically happening around the character (equipment, other people, ambient conditions) and how it affects their energy or posture.
- This section works subtly — it colors the performance without giving direct instructions.

### Director's Notes

- This is where you spend most of your specificity budget. The most common sub-categories are **Style**, **Pacing**, and **Accent**, but you can add anything relevant (breathiness, articulation, energy arcs, etc.).
- Vague adjectives underperform. Compare "energetic and enthusiastic" to something like: describing exactly what the listener should feel, or naming a concrete vocal technique (e.g. a raised soft palate for a brighter, "smiling" tone).
- You can escalate from a single descriptive sentence to a bulleted, multi-part breakdown depending on how much control you need.
- For accents, name a specific region or even a specific place rather than a broad category — "a British accent as heard in a particular English town" gives more reliable results than just "British accent."

### Sample Context

- A short line framing what this voice/character is typically used for (radio spots, tutorial narration, character voice work, etc.). It gives the model a natural "genre" to slot the performance into.

### Transcript

- The literal text to be read aloud.
- Keep its topic and register consistent with the Director's Notes — a mismatch between what's being directed and what's being said undermines the performance.
- This is also where inline **audio tags** go (see below).

---

## Audio tags

Audio tags are short bracketed inline cues placed directly in the transcript to control delivery at a specific point in the text — tone, pace, emotion, or a non-verbal sound. There's no fixed, exhaustive list; treat them as directable cues and experiment.

Ways to use them:

- **At the start of a line**, to set overall emphasis: `[excitedly]`, `[bored]`, `[reluctantly]`
- **To control pace**, alone or combined with emotion: `[very fast]`, `[very slow]`, `[sarcastically, one painfully slow word at a time]`
- **Mid-line, to shift delivery within a single sentence**: e.g. starting a line whispered, jumping to shouting partway through, then dropping back to a whisper
- **For pure creative/character direction**: `[like a cartoon dog]`, `[like a classic vampire]`
- **For non-verbal sounds and interjections**: `[sighs]`, `[cough]`, `[gasp]`

Frequently used tags include: `[amazed]`, `[crying]`, `[curious]`, `[excited]`, `[sighs]`, `[gasp]`, `[giggles]`, `[laughs]`, `[mischievously]`, `[panicked]`, `[sarcastic]`, `[serious]`, `[shouting]`, `[tired]`, `[trembling]`, `[whispers]`.

Notes:
- Tags give fast, local control; combine them with full Director's Notes for a consistent overall tone.
- Even for non-English transcripts, tags themselves are best kept in English.

---

## Full prompt template

```
# AUDIO PROFILE: [Character Name]
## "[One-line archetype/nickname]"

## THE SCENE: [Location name]
[2-4 sentences describing where the character is, the time, the atmosphere,
what's physically happening around them, and how that's affecting their energy.]

### DIRECTOR'S NOTES

Style:
* [Primary stylistic direction — be specific and sensory rather than a single adjective.]
* [Optional secondary style note — e.g. a vocal technique, dynamic range, or emphasis pattern.]

Pacing: [How fast/slow, and whether pace should vary — steady, building, erratic, etc.]

Accent: [Specific region or reference point, not just a broad nationality.]

### SAMPLE CONTEXT
[One or two sentences on what kind of material this voice is typically used for.]

#### TRANSCRIPT
[The actual lines to be spoken, with inline audio tags like [whispers] or
[excitedly] where you want a shift in delivery.]
```

### Worked example

```
# AUDIO PROFILE: Marcus V.
## "The Late-Night Radio Confessor"

## THE SCENE: A rain-soaked broadcast booth
It's 2 AM and the only light in the booth comes from the glowing console dials.
Rain streaks the studio window overlooking an empty highway. Marcus leans in
close to the mic, elbows on the desk, speaking to whoever's still awake and
listening. The city outside has gone quiet; his voice is the only thing moving.

### DIRECTOR'S NOTES

Style:
* Warm, low, and unhurried — like he's talking to one specific person, not
  an audience. A little gravel in the voice from a long shift.
* Let sentences trail off slightly at the end rather than landing hard, as
  if he's thinking out loud.

Pacing: Slow and spacious, with natural pauses between thoughts. No urgency
anywhere in the read.

Accent: General American, softened and unhurried — no regional markers.

### SAMPLE CONTEXT
Marcus hosts a call-in show for insomniacs and night-shift workers; this is
the kind of low-key monologue he opens with before taking calls.

#### TRANSCRIPT
[softly] Hey. If you're still up right now... you're not alone. [pause] I know
it's late. I know the rest of the world's asleep. [warmly] But you and me,
we're gonna get through these next few hours together. [sighs] So go on,
pour yourself something warm, and let's talk.
```

---

## Tips for getting good results

- Keep the whole prompt internally coherent — the scene, notes, and transcript should all point in the same direction.
- Resist the urge to specify every micro-detail; leaving some room tends to produce a more natural read than a rigid, over-constrained one.
- If a prompt isn't landing, try tightening the Director's Notes first — that section carries the most weight.
- Match the transcript's actual content and word choice to the character and mood you've built, not just the instructions around it.
- If you're stuck, you can ask an LLM to sketch a character from a blank version of the template above.

## Known limitations to keep in mind

- These models take text in and produce audio only — no other modalities.
- There's a context window limit per session (in the tens of thousands of tokens), so very long scripts should be split into chunks; quality can drift on outputs longer than a few minutes.
- Vague or under-specified prompts occasionally fail to trigger speech synthesis properly. It helps to open with a short, clear preamble stating that this is speech to be synthesized, and to clearly mark where the actual transcript begins.
- Voice/character mismatches (e.g. directing a deep voice to sound like a young child) can produce inconsistent results — keep the written tone aligned with the selected voice's natural qualities.

## Reference: voice character list

The current voice options and their general character (bright, upbeat, firm, breathy, gravelly, warm, etc.) are listed in the voice-reference.md — worth checking so you can pick a base voice whose natural quality reinforces the direction you're writing rather than fighting it.