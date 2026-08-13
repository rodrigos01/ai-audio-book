# AI Audio Book Backend

This directory contains the Node.js Express backend server built with a domain-driven, Express-decoupled MVC architecture. It manages metadata, orchestrates speech synthesis via Google Cloud Text-to-Speech (Chirp3 and Gemini Multi-Speaker TTS), performs AI voice casting via Gemini 3.6 Flash, and handles Firestore document manipulation.

---

## Architecture & Directory Structure

The backend is organized into single-responsibility layers where controllers are **100% Express-free and HTTP-code-free**:

```
backend/
├── server.js                     # Express application entry point (middleware & route mounting)
├── routes/                       # Presentation & HTTP View Layer (parameter extraction, HTTP status codes, response streaming)
│   ├── titleRoutes.js            # /api/titles endpoints
│   ├── chapterRoutes.js          # /api/chapters endpoints (preparation & audio streaming)
│   ├── voiceRoutes.js            # /api/voices catalog endpoint
│   ├── authRoutes.js             # /api/auth endpoints (title claiming)
│   └── errorHandler.js           # Domain error -> HTTP status code mapping (400, 401, 403, 404, 500)
├── controllers/                  # Pure Business Logic Layer (Zero Express/HTTP references)
│   ├── titleController.js        # Title creation, voice propagation, claimTitles, addChapter (Google Doc & AI casting)
│   ├── chapterController.js      # Chapter updates, deletion, prepareChapter, streamChapterAudio
│   └── voiceController.js        # Voice catalog enrichment
├── stores/                       # Data Management Layer
│   ├── firestoreStore.js         # Unified Firestore database collection queries & batch updates
│   └── audioFileStore.js         # Dedicated file storage manager for MP3 caching
├── services/                     # Domain Services
│   ├── googleDocsService.js      # Google Docs API text extraction service
│   ├── aiCastingService.js       # Gemini 3.6 Flash AI voice casting & SSML script generation
│   ├── ttsService.js             # Google Cloud Text-to-Speech synthesis (Chirp3 & Gemini Multi-Speaker TTS)
│   ├── textSplitterService.js    # Text & SSML sectioning routines with pre-calculated timing
│   └── logger.js                 # Centralized logging helper
├── middleware/                   # Express Middlewares
│   ├── auth.js                   # Firebase ID Token verification
│   └── clientId.js               # Anonymous client ID cookie & header assignment
└── utils/                        # Utilities & Domain Errors
    └── errors.js                 # Semantic domain errors (ValidationError, NotFoundError, UnauthorizedError, ForbiddenError)
```

---

## Domain Errors & Router Translation

Controllers throw semantic domain errors from `utils/errors.js` without referencing any HTTP status codes:

- `ValidationError` -> Router translates to `400 Bad Request`
- `UnauthorizedError` -> Router translates to `401 Unauthorized`
- `ForbiddenError` -> Router translates to `403 Forbidden`
- `NotFoundError` -> Router translates to `404 Not Found`
- Generic `Error` -> Router translates to `500 Internal Server Error`

---

## Authentication System

The backend employs a hybrid authentication model supporting both signed-in users and anonymous sessions:

### 1. Firebase Authentication
* For authenticated API calls, the server expects a Firebase ID token passed in the `Authorization` header (`Authorization: Bearer <ID_TOKEN>`) or `?token=<ID_TOKEN>` query parameter.
* Verified Firebase tokens assign the user's UID to `req.userId`.

### 2. Client ID Cookies (Anonymous Sessions)
* Unauthenticated visitors receive a persistent 1-year anonymous identifier cookie named `client_id`.
* The server uses this `client_id` (stored in `req.clientId`) to associate and query titles created during guest sessions.
* Guest titles can be claimed by a registered user account via `POST /api/auth/claim`.

---

## API Endpoints

### Health Check
* **`GET /health`**
  * Status check endpoint.
  * **Response:** `200 OK` (`OK`)

### Authentication
* **`POST /api/auth/claim`**
  * Claims all anonymous titles matching current `clientId` and re-assigns them to the logged-in `userId`.
  * **Authentication:** Required (Firebase Bearer token)
  * **Response:** `200 OK` (`{ "success": true, "claimed_count": 5 }`)

### Voices
* **`GET /api/voices`**
  * Retrieves available Google Cloud Text-to-Speech voices with preview sample URLs.
  * **Query Parameters:** `tier` (`basic` or `pro`, optional).
  * **Response:** `200 OK` (JSON array of enriched voice objects).

### Titles
* **`POST /api/titles`**
  * Creates a new audiobook title.
  * **Body:** `{ "name": "Title Name", "ai_casting_enabled": true, "tts_tier": "basic", "narrator_voice": "Aoede" }`
  * **Response:** `200 OK` (Created title object).

* **`PATCH /api/titles/:id`**
  * Updates title metadata. Automatically propagates character voice changes to existing SSML chapters.
  * **Authentication:** Required
  * **Body:** `{ "name": "New Name", "casting_map": { "Alice": "Aoede" }, "narrator_voice": "Puck" }`
  * **Response:** `200 OK` (`{ "success": true }`)

* **`DELETE /api/titles/:id`**
  * Deletes a title.
  * **Response:** `200 OK` (`{ "success": true }`)

* **`POST /api/titles/:id/chapters`**
  * Adds a chapter to a title in a single request. Supports raw text content OR Google Docs import via `{ google_doc_id, google_access_token }`. Automatically runs AI voice casting if enabled.
  * **Authentication:** Required
  * **Body:**
    ```json
    {
      "name": "Chapter 1",
      "content": "Raw chapter text...",
      "voice_id": "Aoede",
      "google_doc_id": "1a2b3c...",
      "google_access_token": "ya29..."
    }
    ```
  * **Response:** `200 OK` (Created chapter metadata).

### Chapters
* **`PATCH /api/chapters/:id`**
  * Updates chapter content or name. Cleans up old audio sections and regenerates section timing offsets.
  * **Authentication:** Required
  * **Body:** `{ "name": "New Name", "content": "Updated content..." }`
  * **Response:** `200 OK` (`{ "success": true }`)

* **`DELETE /api/chapters/:id`**
  * Deletes a chapter, its section documents, and associated audio files.
  * **Response:** `200 OK` (`{ "success": true }`)

#### Downloading a chapter for offline playback

Chapter text is split into "sections" (see `textSplitterService.js`), and each section's audio is synthesized via Google Cloud TTS and cached to disk (`audioFileStore.js`) the first time it's needed. `prepare` and `stream` are meant to be used **together** by a client that wants to save a whole chapter for offline, in-app playback (e.g. into IndexedDB) rather than just listen to it live:

1. Call `prepare` repeatedly until it reports `ready: true` — this does all the (potentially slow) TTS synthesis work up front, in bounded batches, without transferring any audio.
2. Call `stream` — since every section is now cached, this is a fast disk-read response with no synthesis latency, so it's safe to treat as a bounded download rather than an open-ended live stream.

A client that only wants normal progressive playback (start listening immediately, tolerate some inline synthesis latency on sections that aren't cached yet) can skip `prepare` and call `stream` directly.

* **`POST /api/chapters/:chapterId/prepare`**
  * Ensures every section of the chapter is synthesized and cached, without streaming any audio back. Each call does a **time-boxed batch of work (~50 seconds)** and returns — it does not block until the whole chapter is done, so anything but a very short chapter needs multiple calls.
  * **Authentication:** Optional. Accepts a Firebase ID token (`Authorization: Bearer <token>` or `?token=`), but a missing or invalid token is not rejected — the request proceeds as an anonymous/guest call. In practice this endpoint does not enforce that the caller owns the chapter's title, so don't rely on it to keep chapter audio private.
  * **Query Parameters:** none.
  * **Response:** `200 OK`
    ```json
    { "totalSections": 42, "generatedSections": 17, "ready": false }
    ```
    * `totalSections` — total number of sections in the chapter.
    * `generatedSections` — number of sections currently cached on disk. Sections cached by a previous call are counted immediately, so a chapter that's already fully generated returns `ready: true` on the very first call.
    * `ready` — `true` once `generatedSections === totalSections`.
  * **Errors:** `404 Not Found` if the chapter doesn't exist, or if AI voice casting is currently running for it (`chapter.ai_casting_status === 'in_progress'`) — retry once casting finishes.
  * **Polling loop (recommended):**
    ```js
    let ready = false;
    let lastGenerated = -1;
    let stallRounds = 0;
    while (!ready) {
      const res = await fetch(`/api/chapters/${chapterId}/prepare`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      ready = data.ready;
      // update UI with data.generatedSections / data.totalSections

      if (!ready) {
        stallRounds = data.generatedSections === lastGenerated ? stallRounds + 1 : 0;
        lastGenerated = data.generatedSections;
        if (stallRounds >= 3) throw new Error('Chapter preparation stalled');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    ```
  * **Caveat:** if a particular section can never be synthesized (e.g. malformed SSML, an unsupported voice ID, content the TTS provider rejects), `generatedSections` simply stops advancing — the endpoint doesn't surface which section failed or why, and `ready` will never become `true` no matter how many times you call this. Clients should track whether `generatedSections` changed between polls and give up (surface an error) after a few consecutive no-progress calls, as in the loop above, rather than polling forever. Check the server logs for the underlying TTS error if this happens.

* **`GET /api/chapters/:chapterId/stream`**
  * Streams chunked MP3 audio for a chapter. **Streams every section from `offset` through the last section, concatenated into one continuous response** — it is not limited to a single section, so `?offset=0` returns the entire rest of the chapter as one ongoing stream. Any section not yet cached is synthesized inline as the stream reaches it (slow unless you called `prepare` first).
  * **Authentication:** Optional and not enforced — accepts the same `Authorization`/`?token=` forms as `prepare`, but there is currently no ownership check at all on this endpoint. Treat it as effectively unauthenticated for access-control purposes.
  * **Query Parameters:**
    * `offset` — the section index to start streaming from (default `0`).
    * `token` — Firebase ID Token (only needed if header authorization isn't used, e.g. for an `<audio src>` tag, which can't set request headers).
  * **Response:** `200 OK`, `Content-Type: audio/mpeg`, `Transfer-Encoding: chunked`. The response ends cleanly once every remaining section has been written.
  * **Errors:** `404 Not Found` if the chapter doesn't exist, if `offset` is beyond the last section (i.e. there's nothing to stream from that point), or if AI voice casting is currently in progress for the chapter. If an unrecoverable error happens **after** the response has already started (headers sent), the connection is destroyed rather than closed gracefully — clients should treat a `fetch` that errors or ends unexpectedly early as a failed download, not a short chapter.
  * **Tip:** call `prepare` first and poll it to `ready: true` if you want this request to be fast and fully bounded (e.g. downloading a whole chapter for offline use). Without that, a chapter with a lot of ungenerated content can keep this connection open for minutes while TTS synthesis happens inline.

---

## Configuration & Environment Variables

Create a `.env` file in the `backend/` directory:

```ini
PORT=3005
STORAGE_BASE_PATH=./storage
GOOGLE_APPLICATION_CREDENTIALS=./ai-audio-book-36e0611138d4.json
GEMINI_API_KEY=AIzaSy...
```
