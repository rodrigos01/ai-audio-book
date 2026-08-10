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

* **`POST /api/chapters/:chapterId/prepare`**
  * Pre-generates and caches section audio files for offline download playback.
  * **Authentication:** Required
  * **Response:** `200 OK` (`{ "totalSections": 10, "generatedSections": 10, "ready": true }`)

* **`GET /api/chapters/:chapterId/stream`**
  * Streams chunked MP3 audio generated from chapter sections. Synthesizes pending sections on demand.
  * **Query Parameters:** `offset` (section index, default `0`), `token` (Firebase ID Token).
  * **Response:** `200 OK` (`Content-Type: audio/mpeg`, chunked transfer encoding).

---

## Configuration & Environment Variables

Create a `.env` file in the `backend/` directory:

```ini
PORT=3005
STORAGE_BASE_PATH=./storage
GOOGLE_APPLICATION_CREDENTIALS=./ai-audio-book-36e0611138d4.json
GEMINI_API_KEY=AIzaSy...
```
