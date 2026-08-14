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

#### Alternate: `deploy-source` scripts (no `cloudbuild.yaml`, with layer caching)

For a quick scoped deploy of the current branch (e.g. to get a live URL for a sandboxed/cloud session that can't otherwise expose a local server), use the `deploy-source` scripts instead:
```bash
npm run deploy-source            # both, sequential (backend first, frontend picks up its URL)
npm run deploy-source-backend    # backend only
npm run deploy-source-frontend   # frontend only (requires the backend service to already exist)

# Optional positional args override the service name(s) instead of the default:
npm run deploy-source-backend -- my-service-name
npm run deploy-source-frontend -- my-frontend-name my-backend-name
npm run deploy-source -- my-backend-name my-frontend-name
```
These (`scripts/deploy-source.js` / `backend/scripts/deploy-source.js` / `frontend/scripts/deploy-source.cjs`, sharing `scripts/deploy-source-helper.js`) build via `gcloud builds submit` with a generated Kaniko config and deploy the resulting image with `gcloud run deploy --image`, instead of `gcloud builds submit --config=cloudbuild.yaml` or plain `gcloud run deploy --source`. Notable differences from the `cloudbuild.yaml` path above:
- **Layers are cached in Artifact Registry via Kaniko (`--cache=true`, 14-day TTL)**, specifically to make `RUN npm install` (and, for the frontend, `RUN npm run build`) skip real work on a repeat deploy with unchanged deps/source. Plain `gcloud run deploy --source` always passes `--no-cache` to the underlying `docker build` (verified against the actual Cloud Build step it generates), and each Cloud Build run is on a fresh ephemeral VM regardless, so there's nothing to reuse without an explicit registry-backed cache like this. Verified end to end: a repeat frontend deploy with no changes shows `Found cached layer, extracting to filesystem` in the Cloud Build log for both `RUN npm install` and `RUN npm run build`, cutting the Kaniko build step from ~1m46s to ~1m6s (most of the remainder is the Kaniko executor image pull and Cloud Build/Cloud Run overhead, not dependency work).
- **Service names default to `claude-develop-ai-audio-book(-api)` in Claude Code cloud sessions** (detected via `CLAUDE_CODE_REMOTE=true`) — a fixed, persistent pair of services, so repeated agent runs across disposable session containers redeploy the same known URL instead of each minting a new one that needs manual teardown. Outside a Claude Code cloud session, the default falls back to a branch-prefixed name (see below). Pass an explicit service name as a CLI arg (see usage above) to override either default — `resolveServiceName` in `scripts/deploy-source-helper.js` is the single place this logic lives.
- **Branch prefix (the non-Claude-env default) is computed from `git rev-parse --abbrev-ref HEAD`**, not Cloud Build's `$BRANCH_NAME` substitution — that substitution is only populated for builds triggered from a connected repo and is empty for a manual submit/deploy, which is what these scripts do (`master` still deploys unprefixed).
- **Requires `backend/Dockerfile.source` and `frontend/Dockerfile.source`**, not `backend/Dockerfile` / `frontend/Dockerfile`. Those Dockerfiles assume a repo-root build context (`COPY backend/...`) because that's how `cloudbuild.yaml` invokes `docker build -f backend/Dockerfile .`; a directory passed as Kaniko's build context can't decouple a Dockerfile's location from its build context either, so the helper stages a clean copy of `backend/`/`frontend/` (skipping `node_modules`, `.env`, credential JSON) with the self-contained `Dockerfile.source` copied in as `Dockerfile`.
- **Frontend build args are baked into `Dockerfile.source`'s `ARG NAME=value` defaults at stage time**, not passed via `--build-arg`/`--set-build-env-vars` — `gcloud run deploy --source` does not pass `--set-build-env-vars` through to `docker build --build-arg` for Dockerfile-based builds (verified against the actual Cloud Build step it generates: no `--build-arg` flags appear). Kept this approach after switching to Kaniko rather than reaching for Kaniko's own `--build-arg` flag, since it works the same way regardless of build mechanism and was already verified working.
- **Runs the backend as `player@ai-audio-book.iam.gserviceaccount.com` directly** (`--service-account`, with `GOOGLE_APPLICATION_CREDENTIALS` explicitly cleared) instead of baking a downloaded key file into the image, so it needs no GCS secrets bucket.
- If a sandbox sets a placeholder `CLOUDSDK_AUTH_ACCESS_TOKEN` for its own proxied Google API calls (seen in Claude Code cloud sessions), `gcloud` prefers that over an activated service account and deploys fail with `UNAUTHENTICATED`; `deploy-source-helper.js` clears that env var for its own `gcloud` calls, but ad-hoc `gcloud` commands still need `env -u CLOUDSDK_AUTH_ACCESS_TOKEN`.

The `.claude/hooks/session-start.sh` SessionStart hook (see below) installs `gcloud` automatically in remote/cloud sessions, so these scripts work there without setup.

#### CI: GitHub Actions for production, agents for `claude-develop`

`.github/workflows/deploy.yml` deploys production on every push to `master`, using the `deploy-source` scripts above (so it gets the same Kaniko layer caching). It authenticates to GCP via **Workload Identity Federation** — no stored key. The trust chain, scoped as tightly as WIF allows:
- Pool: `github-actions-pool`, provider: `github-actions-provider` (both in the `ai-audio-book` project, `global` location).
- The provider's `--attribute-condition` only accepts OIDC tokens where `assertion.repository == 'rodrigos01/ai-audio-book' && assertion.ref == 'refs/heads/master'` — tokens from any other repo, or from any other branch/PR *within* this repo, are rejected before IAM is even consulted.
- `player@ai-audio-book.iam.gserviceaccount.com` grants `roles/iam.workloadIdentityUser` only to the principal set for that same repo, as a second, independent layer of scoping.
- `claude-develop` is deliberately **not** wired into this workflow — that pair stays under direct agent control (`npm run deploy-source` from an interactive Claude Code session), not CI, so this trust relationship never needs to cover more than `master`.

Requires these manually-added secrets (Settings → Secrets and variables → Actions) — nothing is inlined in the workflow file itself, even the Firebase/OAuth values that aren't strictly sensitive (they're already public in the deployed frontend bundle, but not committed to the repo regardless):
```
GEMINI_API_KEY
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_GOOGLE_CLIENT_ID
```
Values match the existing `ai-audio-book-deploy` Cloud Build trigger's substitutions (`gcloud builds triggers describe <id>` to see them, or the Firebase/Google Cloud consoles).

This coexists with the `ai-audio-book-deploy` Cloud Build trigger (push to `master`, see above) unless that trigger is disabled in the Cloud Build console — leaving both enabled means every push to `master` deploys twice, redundantly but not conflictingly (same target services, same result). The `ai-audio-book-deploy-claude-develop` trigger (push to `claude-develop`) is unrelated to this workflow and can stay as-is either way.

`getBranchServicePrefix()` in `scripts/deploy-source-helper.js` checks `GITHUB_REF_NAME` before falling back to `git rev-parse --abbrev-ref HEAD` — required because `actions/checkout` leaves the repo in a detached-HEAD state, where that git command returns the literal string `"HEAD"` instead of the branch name.

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

In Claude Code cloud sessions, `.claude/hooks/session-start.sh` (a `SessionStart` hook, registered in `.claude/settings.json`) handles this automatically: it decodes a `GOOGLE_APPLICATION_CREDENTIALS_BASE64` environment variable (set in the cloud environment's settings) into `~/credentials/service-account.json`, writes `GOOGLE_APPLICATION_CREDENTIALS` into both `$CLAUDE_ENV_FILE` and `backend/.env`, and installs+authenticates `gcloud`. This has to be a session-start hook rather than the environment's own setup script — `GOOGLE_APPLICATION_CREDENTIALS_BASE64` (and any other cloud-environment env var) is only ever injected into the `claude` process's own environment, never into the container entrypoint, `environment-manager`, or anything a setup script runs, since a setup script runs earlier in boot, before that process exists.

## Verification

`skills/ai-audio-book-verification/SKILL.md` has the manual end-to-end flow (create title → add chapter → generate audio → play) and troubleshooting steps (capture browser console logs / screenshot, report rather than deep-diagnosing UI issues in a subagent).
