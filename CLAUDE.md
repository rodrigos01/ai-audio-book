# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AI Audio Book turns written text into a multi-voice audiobook: users create a "title," add chapters, optionally run AI casting (Gemini assigns characters to distinct TTS voices and rewrites the chapter as SSML), then stream the chapter as generated MP3 audio (Google Cloud Text-to-Speech).

## Commands

Run from the repo root unless noted.

```bash
npm run install:all      # install root + backend + frontend deps
npm run dev               # run backend (nodemon, :3005) and frontend (vite, :5173) concurrently
npm run dev-backend       # backend only
npm run dev-frontend      # frontend only
```

Frontend-only:
```bash
cd frontend
npm run lint               # eslint .
npm run build               # vite build -> frontend/dist (served by the backend if present)
```

There is no automated test suite in either package (`backend`'s `npm test` is a placeholder, `frontend` has no test script). Don't assume Jest/Vitest config exists.

### Deploying (Cloud Run via Cloud Build)

Only deploy what you changed — see `skills/ai-audio-book-deployment/SKILL.md` for the full rationale:
```bash
npm run deploy-backend     # backend/ changes only -> backend/cloudbuild.yaml
npm run deploy-frontend    # frontend/ changes only -> frontend/cloudbuild.yaml
npm run deploy             # both, sequential (backend first, frontend picks up its URL) -> cloudbuild.yaml
npm run deploy:parallel    # both, parallel (assumes backend service already exists once)
```
These scripts (`scripts/deploy.js`, `backend/scripts/deploy.js`, `frontend/scripts/deploy.js`) shell out to `gcloud builds submit`, merging `_SUBSTITUTION` values from `.env` files (frontend/backend/root, in that precedence) and `process.env` — see `scripts/deploy-helper.js`.

Cloud Build service naming: all three `cloudbuild.yaml` files (root, `backend/`, `frontend/`) prefix the deployed Cloud Run **services** (`ai-audio-book-api`, `ai-audio-book`) with `<branch>-` using Cloud Build's built-in `$BRANCH_NAME` substitution, except on `master` which deploys unprefixed. The `ai-audio-book-generate-samples` Cloud Run **job** is intentionally exempt and always deploys under that fixed name.

## Architecture

**Monorepo, two independently deployed services**, wired together only through HTTP:
- `backend/` — Node/Express API + audio pipeline, deployed as Cloud Run service `ai-audio-book-api`
- `frontend/` — Vite + React SPA, deployed as its own Cloud Run service `ai-audio-book` (static files via `sirv`)

The root `Dockerfile` builds a single combined image (frontend baked into backend's `frontend/dist`); it's legacy and **not** what the current `cloudbuild.yaml` pipelines deploy — those use `backend/Dockerfile` and `frontend/Dockerfile` separately, as two services. Prefer the per-service Dockerfiles when changing the build.

### Backend (`backend/server.js`)

Single-file Express app (~700 lines) wiring together:
- **`firestore-repository.js`** (extends the abstract `repository.js` interface) — the actual persistence layer, Firestore-backed. `backend/database.js` is a legacy local-JSON-file emulator of the old SQLite-shaped interface; it is **not imported anywhere** — don't extend it, it's dead code kept for reference.
- **`auth.js`** — `authMiddleware` verifies a Firebase ID token from `Authorization: Bearer <token>` or `?token=`, sets `req.user`/`req.userId` (or `null` for anonymous requests — auth is optional almost everywhere).
- **Anonymous identity**: every request also gets/keeps a `client_id` cookie (1yr, httpOnly). Ownership in Firestore is a single `owner_id` field, either `user:<uid>` or `client:<clientId>` (see `_getOwnerId` in `firestore-repository.js`). Anonymous titles get reassigned to `user:<uid>` via `POST /api/auth/claim` (`linkAnonymousBooks`) once a user signs in — this is how "claiming" guest work after login is implemented.
- **`ai-casting.js`** (`AICastingService`) — calls Gemini (`GEMINI_API_KEY`) to analyze a chapter's text, assign characters to voices from `voices.json`/`voices.md`, and emit SSML (`<voice>`/`<p>` tags). Triggered by `POST /api/chapters/:chapterId/cast`.
- **TTS + streaming**: `GET /api/chapters/:chapterId/stream` synthesizes any pending chapter sections via `@google-cloud/text-to-speech` (credentials from `GOOGLE_APPLICATION_CREDENTIALS`, falling back to a local key file) and streams chunked MP3, caching generated audio under `STORAGE_BASE_PATH/audio_files`. In Cloud Run this path is a GCS bucket mounted via FUSE at `/app/storage`; locally it defaults to the backend directory.
- CORS is dynamic (see `server.js`): allows localhost, `*.web.app`/`*.firebaseapp.com`, `*.a.run.app`, plus anything in `ALLOWED_ORIGINS` (comma-separated) — the deploy pipeline sets `ALLOWED_ORIGINS` to the frontend's Cloud Run URL after deploying it (see Step 10 in root `cloudbuild.yaml`).

Data model (Firestore collections): `titles` → `chapters` (ordered by `order_index`) → `chapter_sections` (ordered by `section_index`, each with `status`/`audio_file_path`, synthesized on demand).

### Frontend (`frontend/src/`)

Small React Router app: `App.jsx` defines routes `/` (`pages/Home.jsx`), `/title/:id` (`pages/TitleDetail.jsx`), `/player/:chapterId` (`pages/Player.jsx`), plus `components/Login.jsx` and `context/AuthContext.jsx` for Firebase Auth state. `lib/api.js` is the sole fetch wrapper — it persists `client_id` from response headers into `localStorage` and re-attaches it as `X-Client-ID` on every request (mirrors the backend's cookie-based anonymous identity so it also works cross-origin). `lib/firebase.js` initializes Firebase from `VITE_FIREBASE_*` env vars; `lib/googlePicker.js` backs the Google Docs import feature (`POST /api/google-docs/fetch` on the backend).

## Environment

Backend needs a `backend/.env` with `GEMINI_API_KEY` and `GOOGLE_APPLICATION_CREDENTIALS` (path to the GCP service account JSON). Frontend needs a `frontend/.env` with `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`. Neither file nor `*.json` credential files are committed (see `.gitignore`).

## Verification

`skills/ai-audio-book-verification/SKILL.md` has the manual end-to-end flow (create title → add chapter → generate audio → play) and troubleshooting steps (capture browser console logs / screenshot, report rather than deep-diagnosing UI issues in a subagent).
