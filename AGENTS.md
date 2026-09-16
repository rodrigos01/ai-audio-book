# AGENTS.md

Guidance for AI coding agents working in this repository. Read this before making changes — several things here are non-obvious from the code alone.

## What this is

A REST API backend for an AI-generated podcast app: users create fictional podcast shows (hosts, structure) and episodes (topics, guests, source material), and the app generates a multi-agent conversation transcript via Gemini, then synthesizes it to audio via Gemini TTS, streamed back to the client. Product behavior is specified in [specs.md](specs.md); the prompting conventions for TTS are in [prompting-guide.md](prompting-guide.md) and [voice-reference.md](voice-reference.md).

**specs.md is the product spec, not the API design.** It's silent on several things this backend had to decide — see "Architecture decisions" below before assuming specs.md is complete on its own.

## Architecture decisions not in specs.md

These were made explicitly during development and should be treated as settled unless the user says otherwise:

1. **Firebase Auth is required** (reversed from an earlier "no auth" decision made before the client side existed). Every `/podcasts` route (and everything nested under it) requires a Firebase Auth ID token — see [middleware/requireAuth.ts](src/middleware/requireAuth.ts), which verifies it via `getAuth(firebaseApp).verifyIdToken()` and attaches `req.userId`. Podcasts are scoped by an `ownerId` field set at creation time; [services/podcastAccess.ts](src/services/podcastAccess.ts)'s `requireOwnedPodcast` is the one shared authorization check used by every controller nested under a podcast (sources, episodes, audio) — a podcast that exists but isn't yours is treated identically to one that doesn't exist (404, never 403), deliberately not leaking existence. This backend still uses the Admin SDK exclusively (bypasses Firestore security rules), so `firebase.rules` (gitignored, not in this repo checkout) is enforcing nothing — all authorization happens in application code, and it must mirror what those rules describe (`isOwner` there is the same model as `requireOwnedPodcast` here). `/health` and `/voices` are intentionally left public. The one exception to "auth via header": `.../audio/stream` also accepts `?token=<idToken>` as a query param, since a plain `<audio src>` element can't attach custom headers and specs.md requires that endpoint to work with one.
2. **Firestore subcollections**, not the nested arrays specs.md literally describes: `podcasts/{id}/episodes/{id}` and `podcasts/{id}/sources/{id}` are subcollections. Hosts stay **embedded** on the podcast document (small, bounded ~1-6) — only episodes and sources (unbounded, large text blobs) moved out, to avoid Firestore's 1MiB per-document limit.
3. **Firestore uses a named database, not `(default)`**: set via `FIRESTORE_DATABASE_ID` (currently `podcasts`). See [src/config/firebase.ts](src/config/firebase.ts) — `getFirestore(app, databaseId)`. If you add a new Firestore database or switch projects, this must be created explicitly (`firebase firestore:databases:create`) — it does not exist by default.
4. **Async job pattern for episode generation**: confirming an episode returns `202` immediately with `status: "generating"`; the multi-agent conversation runs fire-and-forget in-process (no queue/Redis). The transcript is persisted to Firestore **after every conversation turn**, not just at the end — see [orchestrator.ts](src/services/episodeGeneration/orchestrator.ts) and [conversationLoop.ts](src/services/episodeGeneration/conversationLoop.ts)'s `onProgress` callback. This means a crash mid-generation loses at most the in-flight turn. There is no automatic resume, though — `POST .../episodes/:id/regenerate` restarts the *entire* conversation from scratch, discarding whatever partial transcript existed. If you're asked to add real resume-from-partial support, that's a legitimate gap, not an oversight.
5. **Stateless wizards**: the server persists nothing until final confirm (`POST /podcasts` or `POST .../episodes`). The client round-trips the current draft/options payload on every revision call.
6. **The episode "2 voices" rule is a hard, always-enforced constraint**, not a default: `participantHostIds.length + guests.length` must equal exactly 2 (zod `.refine` in [episode.schema.ts](src/schemas/episode.schema.ts)). A single-host podcast therefore requires a guest on *every* episode — there is no solo-host mode, and a podcast with >2 hosts requires the client to pick which 2 voices are cast per episode.
7. **Episode length word ranges** (specs.md left `long`'s minimum unstated): short 3500-5000, medium 6500-8000, long 8000-9000 — see [constants/lengthRanges.ts](src/constants/lengthRanges.ts).
8. **Firebase Storage bucket must be explicitly linked** to the Firebase project — creating a GCS bucket and pointing `firebase-admin`'s Storage client at it (via `storageBucket` in `initializeApp`) works at the SDK level but does **not** make it appear in the Firebase console's Storage tab. That requires the `firebasestorage.googleapis.com` API to be enabled on the project and the bucket registered via its bucket-management REST API (`POST .../buckets/{bucket}:addFirebase`). Already done for the current bucket (`ai-audio-book-podcast-audio`); if you provision a new bucket, repeat this.

## The conversational-density lesson (read before touching turn-generation prompts)

Early testing found that generated transcripts read as a "two-way monologue" — each turn a complete, thorough response — regardless of topic (audio gear, celebrity gossip, marine biology) or format (2 co-hosts, host-interviews-guest). That ruled out topic/format as the cause. The actual fix was in [hostPersona.prompts.ts](src/llm/prompts/hostPersona.prompts.ts): explicit persistent guidance that most turns should be short (a reaction, an interjection, a partial thought), that a turn can be a pure reaction with zero new information, and that a speaker can deliberately leave something unfinished as a hook for the other to ask about. **Do not add example phrases to that guidance** — the user explicitly asked to avoid them since concrete examples bias the model toward reusing those exact words.

That fix immediately exposed a second bug: shorter turns need *more* turns to reach the same word-count target, so the old fixed `MAX_TURNS = 60` safety valve in `conversationLoop.ts` started cutting episodes short *below* their minimum word count. It's now scaled off `wordTarget.max` (see `computeMaxTurns`) with an absolute ceiling (`MAX_TURNS_CEILING`) as the actual runaway-loop guard. If you touch turn-length prompting again, re-run the `conversationLoop.test.ts` regression test for this and consider a real episode generation to confirm the turn/word-count relationship still holds.

## Gemini API usage — non-obvious things learned the hard way

- **Text generation** (`gemini-3.8-flash`) uses the plain `models.generateContent` API with `responseSchema` built from the same zod schema used to re-validate the output (`toGeminiSchema` in [geminiClient.ts](src/llm/geminiClient.ts) strips `$schema`/`additionalProperties`, which Gemini's schema dialect rejects). Never trust LLM JSON without the zod re-parse.
- **TTS** (`gemini-3.1-flash-tts-preview`) uses the **Interactions API** (`client.interactions.create`), *not* `models.generateContent`/`generateContentStream`. This was a deliberate correction mid-project — the Interactions API is a distinct, newer surface with its own snake_case shape (`generation_config.speech_config: [{speaker, voice}]`, `response_format: {type: "audio"}`, `stream: true`) and its own SSE event shape (`event_type: "step.delta"`, `delta.type: "audio"`, `delta.data` base64). Confirmed empirically against the live API — don't trust a doc snippet's exact shape without checking `node_modules/@google/genai/dist/node/node.d.ts` first, since fetched documentation summaries have been wrong before in this project's history (a `WebFetch` summary once hallucinated a very similar-looking but nonexistent API shape).
- **Only raw PCM (`audio/l16`, 24kHz mono) is supported for this TTS model** — explicitly requesting `audio/wav`, `audio/mp3`, or `audio/ogg_opus` as `response_format.mime_type` is rejected outright by the API (`"Audio MIME type ... is not supported for models/gemini-3.1-flash-tts-preview"`). We wrap PCM in a WAV header ourselves ([utils/wav.ts](src/utils/wav.ts)).
- **A long-lived Interactions stream can drop mid-transfer** (observed `ECONNRESET` → an uncaught `TypeError: terminated` from undici) in a way that crashes the whole Node process, not just the one request, if unhandled. `streamSpeech` wraps its `for await` consumption in try/catch, and `index.ts` installs `process.on('uncaughtException'/'unhandledRejection')` handlers as a second line of defense — **do not remove either** without a better mitigation in place.
- **The SDK logs a recurring `MaxListenersExceededWarning` on a shared `PassThrough`** across multiple sequential `interactions.create({stream:true})` calls within one process lifetime. Appears to be internal to `@google/genai`, not our code; harmless so far (a warning, not a crash) but worth knowing about if debugging memory/listener issues later.
- **`countTokens`/text-gen calls are cheap; TTS calls are not** — a single ~1000-token TTS chunk can take 45-90+ seconds to fully synthesize. Don't add short client-side timeouts when testing audio generation manually, and don't casually re-trigger full episode audio generation while iterating — it costs real API quota and wall-clock time. `chunker.ts` intentionally targets ~1000-token chunks (`TARGET_CHUNK_TOKENS`), not the much larger `MAX_TTS_INPUT_TOKENS` input ceiling, specifically so audio streaming can start playback quickly rather than requiring one giant multi-minute TTS call per episode.
- **Concurrent requests for the same not-yet-generated audio chunk must be deduplicated.** `audio.service.ts` keeps an in-process `Map` of in-flight per-chunk generation promises (`inFlightGenerations`) so a retried/duplicate request awaits the same generation instead of triggering a redundant (and costly) second TTS call. If you touch that file, preserve this — it's not optional cleverness, it's what stopped a real resource-exhaustion bug found during testing.
- **`@google/genai`'s type declarations trip up TypeScript's Node16/NodeNext module resolution** for a plain `import`/`require` (shared `types` field across import/require conditions in its `package.json` exports map, and the package is ESM-first). The fix in use: a dynamic `import("@google/genai")` inside `getClient()`, plus a type-only import guarded with `with { "resolution-mode": "import" }`. Don't "simplify" this back to a static import without re-testing `tsc --noEmit`.

## Other gotchas

- **`pdf-parse` v2's API is class-based** (`new PDFParse({ data: buffer }).getText()`), not the v1 `pdf(buffer)` function — don't follow v1-era examples. Use `result.pages[].text` joined with `\n\n`, not `result.text`, which includes ugly `-- N of M --` page markers.
- **`firebase-admin` v14 wants the modular API** (`initializeApp`/`getFirestore`/`getStorage` from `firebase-admin/app`, `/firestore`, `/storage`), not the old namespaced `admin.initializeApp()` style.
- **`dotenv` v17 prints random self-promotional "tips" to stdout on load.** Not a compromise, just noise — suppressed via `dotenv.config({ quiet: true })` in [config/env.ts](src/config/env.ts). Don't reintroduce a bare `import "dotenv/config"`.
- **TypeScript here is v7** (the newer compiler); `moduleResolution` only accepts `node16`/`nodenext`/`bundler` — `"node"` (classic) is gone. This repo uses `module: "Node16"` + `moduleResolution: "Node16"`, which still allows extensionless relative imports for CommonJS output (no `.js` suffix needed), unlike a straight ESM setup.
- **Compound Firestore queries mixing `array-contains` with `orderBy` on another field need a manually-provisioned composite index.** `getRecentCondensedSummariesForHost` in [episode.repository.ts](src/data/episode.repository.ts) deliberately filters in memory instead, to avoid that operational dependency — fine at this app's expected scale (episodes per podcast).
- **Firestore rejects `undefined` field values outright** (throws, doesn't silently drop them). Any optional field must be omitted via spread (`...(x ? {field: x} : {})`), never set to `undefined`.

## Audio delivery (`/stream`)

`GET /podcasts/:podcastId/episodes/:episodeId/audio/stream` serves the episode's audio as **one continuous WAV resource** — not the discrete per-chunk endpoints an earlier version of this API had. See [audio.service.ts](src/services/audio.service.ts) for the full logic; the short version:

- If every chunk is already cached in Storage: serves a normal static resource (`Content-Length`, `Accept-Ranges: bytes`, honors any `Range` request — full seek support).
- Otherwise: serves `Transfer-Encoding: chunked` (no `Content-Length`, since the final size isn't known yet), generating and caching each uncached chunk live via `streamSpeech`, writing PCM bytes to the response as they arrive. The WAV header uses the classic "unknown length" convention (`0xFFFFFFFF` in the size fields) for this case — widely tolerated by browsers/native players, not universally guaranteed.
- A `Range: bytes=N-` request resumes from byte `N`: if `N` falls in the already-cached prefix, serves precisely from there; if it falls into ungenerated territory, generates that chunk (from its own start) but only starts writing to *this* response once enough bytes exist to reach `N` — the chunk still gets cached in full regardless.
- Per specs.md's "Audio Delivery" section: scrubbing ahead of what's been generated is intentionally not supported; once every chunk exists, playback behaves like a normal seekable file.
- A `?t=<seconds>` query param lets a client resume by saved playback time instead of a raw byte offset — `secondsToByteOffset` in [utils/wav.ts](src/utils/wav.ts) does the conversion using the fixed PCM format constants there. It's handled as fully equivalent to an appropriately-computed `Range` header (same 206/chunked behavior); an actual `Range` header on the same request takes precedence if both are present. If the PCM format ever changes (different sample rate/bit depth/channels), update `PCM_FORMAT` in that file — don't hardcode the byte-rate math anywhere else.

Cache layout in Storage: `podcasts/{podcastId}/episodes/{episodeId}/audio/chunk-{index}.pcm` — **raw headerless PCM**, not individually WAV-wrapped, so chunks concatenate cleanly into one stream.

## Project structure

```
src/
├── config/          — env validation, Firebase Admin SDK init
├── routes/          — Express route wiring (thin)
├── controllers/      — request/response glue (thin)
├── services/
│   ├── podcastWizard.service.ts, episodeWizard.service.ts, source.service.ts, audio.service.ts
│   └── episodeGeneration/   — the multi-agent conversation pipeline (see below)
├── llm/
│   ├── geminiClient.ts      — the only place @google/genai is imported
│   └── prompts/             — one file per prompt-building concern
├── data/            — Firestore repositories (one per top-level/subcollection resource)
├── storage/         — Firebase Storage (audio cache)
├── schemas/         — zod schemas; source of truth for types AND validation AND Gemini responseSchema
├── constants/        — voices.ts (30 prebuilt voice IDs), lengthRanges.ts
├── middleware/, utils/
```

`episodeGeneration/` pipeline, in the order `orchestrator.ts` runs them: `speakerSelection.ts` (one-time cast decision) → `agent.ts`/`conversationLoop.ts` (the turn-by-turn conversation) → `transcriptBuilder.ts` → `producerPrompt.service.ts` (TTS base prompt) → `chunker.ts` → `condensation.service.ts` (continuity for next time). `audio.service.ts` (top-level `services/`, not `episodeGeneration/`) is the on-demand TTS/streaming layer, run later, on request.

## Running things

```bash
npm run dev      # tsx watch, port from .env (PORT)
npm run build && npm start   # production-ish
npm test         # vitest — fast, no network calls, safe to run freely
npm run smoke    # scripts/smoke-test.ts — full real HTTP flow, costs real Gemini/TTS quota, takes minutes
```

`.env` needs: `GEMINI_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_PATH`, `FIREBASE_STORAGE_BUCKET`, `FIRESTORE_DATABASE_ID` (defaults to `podcasts`), `PORT`.

**Manual E2E testing convention used throughout development**: start the dev server in the background (`nohup npx tsx src/index.ts > /tmp/....log 2>&1 &`), drive it with `curl` against the real Gemini API, poll `GET .../episodes/:id/status` until `ready`/`failed`. This is real, billed API usage — be deliberate about how many full episodes/audio chunks you generate while testing; a full episode is 5-10 minutes of wall-clock time and multiple LLM + TTS calls. Always `fuser -k 3000/tcp` (or kill by PID) before restarting — a half-killed dev server left listening on port 3000 has caused confusing "stale server" debugging sessions before.

## Testing philosophy in this codebase

- **Pure logic gets unit tests** (vitest, `test/`): word counting, speaker-cast selection, the two-voice zod refinement, conversation stop-conditions (via mocked `ConversationAgent`s, not real Gemini calls), the transcript chunker, deterministic prompt rendering.
- **Everything touching a real external API (LLM text-gen, TTS, Firestore, Storage) is verified manually against the live services**, not mocked in automated tests — this project has no test-double layer for `@google/genai` or `firebase-admin`. If asked to add automated coverage for those paths, that's new scope, not a gap to silently "fix."
