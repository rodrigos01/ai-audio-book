# AI Audio Book Backend

This directory contains the Node.js Express server that manages the metadata, orchestrates speech synthesis via Google Cloud Text-to-Speech, analyzes chapters using Gemini for voice casting, and handles Firestore document manipulation.

---

## Table of Contents
1. [Authentication System](#authentication-system)
2. [API Endpoints](#api-endpoints)
3. [Configuration & Environment Variables](#configuration--environment-variables)

---

## Authentication System

The backend employs a hybrid authentication model to support both signed-in users and anonymous sessions:

### 1. Firebase Authentication
* For authenticated API calls, the server expects a Firebase ID token.
* The server retrieves this token using the `authMiddleware` ([backend/auth.js](file:///home/rodrigo/dev/node/ai-audio-book/backend/auth.js)):
  * **Authorization Header:** `Authorization: Bearer <ID_TOKEN>`
  * **Query Parameter:** `?token=<ID_TOKEN>` (primarily used for streaming audio where custom headers are difficult to send).
* Verified Firebase tokens assign the user's UID to `req.userId`.

### 2. Client ID Cookies (Anonymous Sessions)
* When a user visits the app without signing in, the server assigns a persistent, 1-year anonymous identifier cookie named `client_id` ([backend/server.js](file:///home/rodrigo/dev/node/ai-audio-book/backend/server.js#L91-L100)).
* The cookie options are `{ maxAge: 1 year, httpOnly: true, sameSite: 'lax' }`.
* The server uses this `client_id` (stored in `req.clientId`) to group and query titles created by the anonymous user.
* Anonymous titles can later be linked (claimed) to a registered user account via the `/api/auth/claim` endpoint.

---

## API Endpoints

### Health Check
* **`GET /health`**
  * Status check endpoint bypasses general middlewares.
  * **Response:** `200 OK` (plain text)

### Authentication
* **`POST /api/auth/claim`**
  * Promotes all titles owned by the current `clientId` to be owned by the authenticated `userId`.
  * **Authentication:** Required (Must provide Firebase ID token)
  * **Response:** `200 OK`
    ```json
    { "success": true, "claimed_count": 5 }
    ```

### Voices
* **`GET /api/voices`**
  * Retrieves all available Google Cloud Text-to-Speech voices from the internal list with corresponding preview sample URLs.
  * **Authentication:** Optional/None
  * **Response:** `200 OK`
    ```json
    [
      {
        "id": "en-US-Chirp3-HD-Aoede",
        "name": "Aoede (HD)",
        "gender": "FEMALE",
        "lang": "en-US",
        "sampleUrl": "/samples/en-US-Chirp3-HD-Aoede.mp3"
      }
    ]
    ```

### Titles
* **`POST /api/titles`**
  * Creates a new audiobook title.
  * **Authentication:** Optional (Uses `clientId` and optional `userId` context)
  * **Body:**
    ```json
    {
      "name": "My New Audiobook",
      "ai_casting_enabled": true
    }
    ```
  * **Response:** `200 OK` with the created title metadata.

* **`PATCH /api/titles/:id`**
  * Updates title metadata (e.g., name, narrator voice, or casting maps).
  * **Authentication:** Required (User must own the title)
  * **Body:**
    ```json
    {
      "name": "Updated Title Name",
      "casting_map": {
        "NARRATOR": "en-US-Chirp3-HD-Aoede",
        "Alice": "en-US-Journey-F"
      },
      "narrator_voice": "en-US-Chirp3-HD-Aoede"
    }
    ```
  * **Response:** `{ "success": true }`

* **`DELETE /api/titles/:id`**
  * Deletes a title.
  * **Authentication:** Optional/Context-based (User must own the title)
  * **Response:** `{ "success": true }`

### Chapters
* **`POST /api/titles/:id/chapters`**
  * Adds a chapter to the title. If AI casting is enabled on the title, it parses the content and generates SSML voice markers.
  * **Authentication:** Required (User must own the title)
  * **Body:**
    ```json
    {
      "name": "Chapter 1: The Beginning",
      "content": "Chapter text contents...",
      "voice_id": "en-US-Chirp3-HD-Aoede"
    }
    ```
  * **Response:** `200 OK` containing created chapter metadata and ID.

* **`PATCH /api/chapters/:id`**
  * Updates chapter content or name. Changing the content deletes old generated audio sections and schedules new ones.
  * **Authentication:** Required (User must own the parent title)
  * **Body:**
    ```json
    {
      "name": "Chapter 1: Redux",
      "content": "Updated chapter contents...",
      "is_ssml": false
    }
    ```
  * **Response:** `{ "success": true }`

* **`DELETE /api/chapters/:id`**
  * Deletes a chapter.
  * **Authentication:** Optional/Context-based (User must own the parent title)
  * **Response:** `{ "success": true }`

* **`POST /api/chapters/:chapterId/cast`**
  * Triggers Gemini-based character analysis to map dialogue to different voices and outputs SSML syntax.
  * **Authentication:** Required (User must own the parent title)
  * **Response:** `200 OK`
    ```json
    {
      "success": true,
      "casting_map": {
        "Narrator": "en-US-Chirp3-HD-Charon",
        "Bob": "en-US-Chirp3-HD-Fenrir"
      },
      "ssml": "<speak>...</speak>",
      "sections_count": 5
    }
    ```

### Audio Streaming & Generation
* **`GET /api/chapters/:chapterId/stream`**
  * Streams chunked MP3 audio generated from the chapter's sections. Automatically invokes Google Cloud Text-to-Speech synthesis for any pending sections and caches the audio files locally.
  * **Authentication:** Required (Checks authorization bearer token or `token` query parameter)
  * **Query Parameters:**
    * `offset`: The section index to start streaming from (default is `0`).
    * `token`: Firebase ID Token (if header authorization isn't used).
  * **Response:** `200 OK` with `Content-Type: audio/mpeg` using chunked transfer encoding.

### Google Docs Integration
* **`POST /api/google-docs/fetch`**
  * Authenticates with Google Drive/Docs API using a provided Google Access Token to retrieve document text content.
  * **Authentication:** Receives a `googleAccessToken` in the request body.
  * **Body:**
    ```json
    {
      "documentId": "1a2b3c4d5e6f...",
      "googleAccessToken": "ya29.a0AfH6S..."
    }
    ```
  * **Response:**
    ```json
    {
      "title": "My Google Doc Title",
      "content": "Extracted text content from the document..."
    }
    ```

---

## Configuration & Environment Variables

Make sure to establish a `.env` file in the `backend/` directory with the following properties:

```ini
PORT=3005
STORAGE_BASE_PATH=./storage
GOOGLE_APPLICATION_CREDENTIALS=./ai-audio-book-36e0611138d4.json
```
