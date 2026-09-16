# AI Audiobook API

This is a second part of the same app described in `specs.md`, reusing its LLM- and TTS-based generation techniques for a different product: turning a book's own text into a fully-cast, narrated audiobook. It shares the same backend, authentication model, and Gemini-based technical stack as the Podcast side, but uses its own Firestore database (`audiobooks`) since Titles/Chapters/Cast/Scenes are a different shape from Podcasts/Episodes/Hosts. Where something is identical to the Podcast side, this document says so rather than repeating it in full — see `specs.md` for the underlying mechanism.

## Basic Product Specifications

### Titles and Chapters
Users will be able to create audiobook Titles and, within each Title, Chapters. A Title has just a name and an optional description — there's no generation step at Title creation (see Creating Titles). A Chapter's content comes directly from source material the user provides for it — unlike a Podcast episode, where uploaded material is background reading for the hosts, a Chapter's source material *is* what gets performed.

### Title Cast
Each Title has a Cast: character name, persona, and voice, for anyone who might speak anywhere in the book — this plays the same role Hosts play for a Podcast, but unified into one list rather than split into fixed hosts vs. per-episode guests. A Cast member responsible for non-dialogue narration (description, exposition) is just another Cast entry with its own persona and voice, not a special reserved role.

A Title's Cast starts empty and is built up entirely through Chapters: creating a chapter analyzes its source material for speaking characters and proposes personas/voices for any that aren't already in the Cast (see Chapter Creation). Confirming a chapter commits those additions/edits back into the Title's Cast, so later chapters can reuse them.

### Chapter Source Material
For Podcasts, uploaded material is optional background reading that hosts and guests draw on while improvising a conversation. For audiobooks the relationship is direct instead: a Chapter has exactly one piece of source material, and that text *is* the content to be performed, essentially word-for-word. There is no topic research or content-generation step — the director's job (see Audio Script Generation) is to take that fixed text and turn it into a performable, speaker-tagged script, never to write new material.

### Faithful Narration
**The director is forbidden from altering the wording of the original source text.** The only edit it's permitted to make is removing a purely redundant speech attribution — a bare "he said," "she said" that adds no information beyond who is speaking. Any attribution that adds scene detail, emotional color, or manner of delivery (a "she said, barely above a whisper," a "he snapped, still facing the window") must be preserved — that detail is exactly what a director's audio tags should draw from, not discard. This is a hard constraint on generation, not a stylistic preference, and it applies to every word of the narration and dialogue alike, not just to attributions. The same fidelity rule governs a chapter's suggested name: if the source material itself contains a title line, that title must be used verbatim, not paraphrased or reinvented.

## Title Creation Experience

### Creating Titles
Users directly input a title name and an optional description — nothing is generated at this stage, since there's no content yet to base anything on. This commits immediately to the database as the Title, with an empty Cast.

### Editing Titles
Users can edit a Title's name, description, and Cast at any time. Changes only affect chapters generated from that point forward — an already-generated chapter keeps whatever script and cast it was generated with.

### Chapter Creation
1. User uploads the chapter's source text (required — this is the material to be performed; no other input is needed at this step).
2. The app analyzes the material in one pass and returns a chapter draft:
    - a **suggested chapter name** — taken verbatim from the material's own title line if it has one (see Faithful Narration), otherwise inferred from the content;
    - a brief **synopsis**, for display in clients — this is UI-facing summary text, never performed;
    - the **scenes** the chapter breaks down into (see below);
    - the **characters** appearing in the chapter, cross-referenced against the Title's existing Cast — an already-known character comes back with its existing persona/voice, and a newly-detected character comes back with a persona and voice the app has suggested for it.
3. Each scene in the draft has: an identifying **name**, a **description** (feeds the prompting-guide.md Scene block — location, time, atmosphere), **director's notes** (feeds the Director's Notes block), and **sample context** (feeds the Sample Context block) — all pre-filled by the analysis pass, since a chapter's TTS prompt has to be built per-scene rather than once for the whole chapter (see Audio Script Generation).
4. Users can edit anything in the draft — scene names/descriptions/notes/context, and character names/personas/voices, including adding or removing either — before confirming. The source text itself is never editable.
5. Confirming the chapter commits any new or edited characters into the Title's Cast, and begins Audio Script Generation.

## Technical Specifications

### Authentication
Same model as the Podcast side (see `specs.md`): every Title/Chapter/Cast/Source/audio endpoint requires a Firebase Auth ID token, and a Title (and everything nested under it) is private to the user who created it.

### Database
The app will use a separate Firebase Firestore database, `audiobooks`, with the following structure:

- Titles
    - id
    - Title
    - **owner_id**
    - **description** - A brief description, mostly for displaying on clients
    - **cast** (nested array):
        - name
        - **voice** - Voice ID from the TTS service
        - **persona** - A description of this character
    - **chapters** (nested array):
        - id
        - Title
        - **synopsis** - Brief, UI-facing summary; never performed
        - **source_id** - The one source containing this chapter's text (a single required reference, not an optional multi-select list — see Chapter Source Material)
        - **cast_ids** - Which of the Title's cast members appear in this chapter
        - **scenes** (nested array):
            - id
            - name
            - **description** - The Scene block of this scene's TTS prompt
            - **director_notes** - The Director's Notes block
            - **sample_context** - The Sample Context block
            - **script** - The performable, speaker-tagged script for this scene's span of the source text
            - **TTS Prompt** - The rendered base prompt for this scene (its Scene/Director's Notes/Sample Context blocks plus an Audio Profile block per character speaking in it)
    - **sources** (nested array)
        - id
        - title
        - contents

Note: there is no `Length` field here the way a Podcast episode has one. A Podcast episode's length is a *target* the multi-agent conversation aims for; a Chapter's length is simply whatever its source material's length is — there's nothing to target.

### Audio Script Generation
A single LLM, acting as an audiobook director, converts a chapter's fixed source text into a performable script, scene by scene.

* **Scene & character analysis:** before confirmation (Chapter Creation step 2), one LLM pass over the chapter's source text produces the suggested name, synopsis, scene breakdown, and character list described there. Breaking the chapter into scenes exists specifically because a TTS prompt's Scene block has to describe one location/atmosphere — a chapter that moves between physical scenes needs a distinct prompt per scene, not one prompt for the whole chapter.
* **Script generation:** once confirmed, the director produces each scene's actual script from that scene's span of the source text — one LLM call per scene, or a small deterministic set of calls if a single scene is too long for one — following Faithful Narration's fidelity constraint. This should be validated after generation (e.g. diffing the script's dialogue, with attributions stripped, against the source text), not only enforced by instruction.
* **Prompt generation:** each scene renders its own base TTS prompt from its Description/Director's Notes/Sample Context plus an Audio Profile block for each character who speaks within it — unlike a Podcast episode, which has one shared base prompt for its whole (always exactly 2-voice) runtime.

### Chunking
The chunker must guarantee no more than 2 distinct voices per chunk — the TTS service's hard limit — the same as the Podcast side. A Podcast episode's fixed 2 voices satisfy this by construction; a Chapter's scene does not, since any number of characters can appear in one scene and dialogue among 3+ of them is common. Chunk boundaries are found within a single scene's script — never merging across a scene boundary, since each scene has its own base prompt — and, within that, the chunker must track how many distinct voices are already active in the chunk it's building and force a break the moment the next line would introduce a 3rd voice, even if that chunk's token budget isn't exhausted yet.

### Audio Delivery
Same mechanism as the Podcast side (see `specs.md`'s Audio Delivery section): audio is generated on-demand, chunk by chunk, using the TTS service's streaming capability, and delivered through the equivalent of a `/stream` endpoint — compatible with standard playback, pausable/resumable but not scrubbable ahead of what's been generated, and behaving like a normal file once every chunk exists. For a Chapter this spans all of its scenes in order, presented to the listener as one continuous chapter.

### Technical Stack
Same models and integration as the Podcast side (`gemini-3.8-flash` for text, `gemini-3.1-flash-tts-preview` for TTS, via `@google/genai`), same Firebase project — just the separate `audiobooks` Firestore database.
