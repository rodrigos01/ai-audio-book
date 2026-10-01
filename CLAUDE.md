# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AI Audio Book turns written text into a multi-voice audiobook: users create a "title," add chapters, optionally run AI casting (Gemini identifies characters, gives each named character a custom-designed voice and each supporting character a Voice Library voice, and rewrites the chapter as a `Speaker: text` script), then stream the chapter as generated AAC audio (Gemini 3.8 Flash TTS on the Gemini Enterprise API).

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

Cloud Build service naming: all three `cloudbuild.yaml` files (root, `backend/`, `frontend/`) prefix the deployed Cloud Run **services** (`ai-audio-book-api`, `ai-audio-book`) with `<branch>-` using Cloud Build's built-in `$BRANCH_NAME` substitution, except on `master` which deploys unprefixed.

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

#### CI: GitHub Actions deploys both production and `claude-develop`

`.github/workflows/deploy.yml` deploys on every push to `master` (production: `ai-audio-book`/`ai-audio-book-api`, unprefixed) or `claude-develop` (the shared dev pair: `claude-develop-ai-audio-book(-api)`). **This is the preferred way to update `claude-develop`** — push there instead of running `npm run deploy-source` interactively:
```bash
git push origin HEAD:claude-develop --force
```
(force, since `claude-develop` is a shared, disposable pointer to "whatever's being tested right now," not a branch with meaningful history — the same spirit as the `claude-develop-*` services themselves always being redeployed over each other.) It's faster than the interactive path (see below) and doesn't need a Claude Code cloud session at all — an agent working from a local checkout or any other environment can trigger the same deploy this way.

It authenticates to GCP via **Workload Identity Federation** — no stored key. The trust chain, scoped as tightly as WIF allows:
- Pool: `github-actions-pool`, provider: `github-actions-provider` (both in the `ai-audio-book` project, `global` location).
- The provider's `--attribute-condition` only accepts OIDC tokens where `assertion.repository == 'rodrigos01/ai-audio-book' && (assertion.ref == 'refs/heads/master' || assertion.ref == 'refs/heads/claude-develop')` — tokens from any other repo, or from any other branch/PR *within* this repo, are rejected before IAM is even consulted.
- `player@ai-audio-book.iam.gserviceaccount.com` grants `roles/iam.workloadIdentityUser` only to the principal set for that same repo, as a second, independent layer of scoping.
- Widening this from `master`-only to also cover `claude-develop` doesn't grant push-and-deploy power to anyone who didn't already have it — a push to `claude-develop` already triggered a deploy via the pre-existing `ai-audio-book-deploy-claude-develop` Cloud Build trigger (see below), just through a different service account.
- A `concurrency` group (`deploy-${{ github.ref }}`, `cancel-in-progress: true`) cancels an in-flight run for a branch when a new push to that same branch arrives, since two overlapping `gcloud run deploy` calls against the same service can finish out of order and leave the wrong revision serving traffic. Concurrent pushes to *different* branches (e.g. `master` and `claude-develop` at the same time) run independently — they target different services, so there's nothing to race.

Unlike `deploy-source`, this workflow does **not** build via Kaniko/Cloud Build — GitHub-hosted runners have a real Docker daemon (the interactive scripts don't, which is why they need Kaniko at all), so it builds directly with `docker/build-push-action` + `docker/setup-buildx-action`, using Buildx's native GitHub Actions cache backend (`cache-to: type=gha,mode=max` / `cache-from: type=gha`, one cache `scope` per service) instead of Kaniko's registry-based cache. This skips the Cloud Build provisioning latency, the Kaniko executor image pull, and the GCS source-upload round trip that `deploy-source` pays on every run. Confirmed faster in practice, not just in theory: a cold run took 2m53s and a cache-warmed run 1m43s, both for a combined backend+frontend+CORS deploy, against a `deploy-source` baseline of 3m1s with no caching at all and one that's still slower even *with* Kaniko's cache warm (backend 1m2s + frontend 2m5s ≈ 3m7s combined) — because Kaniko/Cloud Build overhead (provisioning, the executor image pull) is paid twice per deploy regardless of cache state, and only building directly on the runner removes that, not caching alone. `scripts/actions-deploy.js` (CLI, called from workflow steps via `node scripts/actions-deploy.js <command>`, writing results to `$GITHUB_OUTPUT`) handles everything around that build step — staging the Dockerfile context and deploying an already-built image — by re-exporting the relevant pieces of `scripts/deploy-source-helper.js` (`stageSourceDir`, `stageFrontendSourceDir`, `deployBackendImage`, `deployFrontendImage`, etc.), so service naming, staging, and the actual `gcloud run deploy` flags stay identical between both paths and only the build mechanism differs.

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

This coexists with the `ai-audio-book-deploy` (push to `master`) and `ai-audio-book-deploy-claude-develop` (push to `claude-develop`) Cloud Build triggers unless both are disabled in the Cloud Build console — leaving them enabled means every push deploys twice, redundantly but not conflictingly (same target services, same result, different service account).

The `npm run deploy-source*` scripts (above) remain useful as a fallback — e.g. a one-off deploy under a custom service name, or somewhere GitHub Actions isn't reachable — but pushing to `claude-develop` is the faster default for agents.

`getBranchServicePrefix()` in `scripts/deploy-source-helper.js` checks `GITHUB_REF_NAME` before falling back to `git rev-parse --abbrev-ref HEAD` — required because `actions/checkout` leaves the repo in a detached-HEAD state, where that git command returns the literal string `"HEAD"` instead of the branch name. This is what makes both `master` and `claude-develop` resolve to the right service names automatically in this workflow, with no branch-specific code.

## Architecture

**Monorepo, two independently deployed services**, wired together only through HTTP:
- `backend/` — Node/Express API + audio pipeline, deployed as Cloud Run service `ai-audio-book-api`
- `frontend/` — Vite + React SPA, deployed as its own Cloud Run service `ai-audio-book` (static files via `sirv`)

The root `Dockerfile` builds a single combined image (frontend baked into backend's `frontend/dist`); it's legacy and **not** what the current `cloudbuild.yaml` pipelines deploy — those use `backend/Dockerfile` and `frontend/Dockerfile` separately, as two services. Prefer the per-service Dockerfiles when changing the build.

### Backend (`backend/server.js`)

Single-file Express app (~700 lines) wiring together:
- **`stores/firestoreStore.js`** — the Firestore persistence layer (collections `titles`, `chapters`, `chapter_sections`). Older docs and this file's history mention `firestore-repository.js`/`repository.js`; those no longer exist. `backend/database.js` is a legacy local-JSON emulator that is **not imported anywhere** — don't extend it.
- **`auth.js`** — `authMiddleware` verifies a Firebase ID token from `Authorization: Bearer <token>` or `?token=`, sets `req.user`/`req.userId` (or `null` for anonymous requests — auth is optional almost everywhere).
- **Anonymous identity**: every request also gets/keeps a `client_id` cookie (1yr, httpOnly), also accepted as `X-Client-ID` / `?client_id=`. Ownership in Firestore is a single `owner_id` field, either `user:<uid>` or `client:<clientId>` (see `_getOwnerId` in `stores/firestoreStore.js`). Anonymous titles get reassigned to `user:<uid>` via `POST /api/auth/claim` once a user signs in.
- **AI casting (`services/aiCastingService.js`)** — Gemini (`gemini-3.8-flash` via the enterprise API) lists a chapter's characters, tags each `named` or `supporting`, writes a voice-only description per character, then rewrites the chapter as a `Speaker: text` script (one turn per line, an optional `Style:` line after a turn, inline `<laugh>`-style tags, and `|backchannel|` reactions layered in a speaker's line when the text supports it; parsed by `services/scriptText.js`). Triggered from `titleController.addChapter`. Results land in `title.voices` (see `frontend/docs/firestore_schema.md`).
- **Voices (`services/voiceResolutionService.js`)** — named characters and the narrator get a **Voice Design** voice (Voices API `voices.create`, `VOICE_TYPE_PROMPTED`, stored in the project, reused across chapters); supporting characters get a **Voice Library** voice (`voices.list`, best description match not already used). Design is slow (~15-25 s), prompt-sensitive (some wordings hang/500 — the API says "try rephrasing") and quota-limited, so `designVoice` has a hard 60 s ceiling, retries once with a simplified description (rewritten by Gemini), and on failure the resolver falls back to the library (`fallback: true`). Don't design voices in parallel (per-minute create quota). Designed voices are deleted on re-design and title delete. In first-person narration the `Narrator` entry is an alias (`aliasOf`) of the narrating character and the script labels narration with that character's name, so one voice performs both. Pre-migration titles (no `title.voices`) map their old `casting_map`/`narrator_voice` ids to library voices. The project's voice list is shared with other apps (ai-podcasts-api's stored voices appear in it) — only ever delete voices this app created.
- **TTS (`services/ttsService.js` + `geminiTtsClient.js` + `audioEncoder.js`)** — `GET /api/chapters/:id/hls/segment/:n` (and `/stream`, `/prepare`) synthesizes pending sections **synchronously** through the **Gemini Enterprise API** (`new GoogleGenAI({ enterprise: true, project, location: 'global' })`, Application Default Credentials — no API key): `models.generateContentStream` (model `gemini-3.8-flash-tts`, buffered server-side) with `speechMetadata` (`speaker`, `style`) per part and `speechConfig` (`voiceConfig` for one speaker, `multiSpeakerVoiceConfig` for exactly two) → raw PCM (24 kHz s16le mono) → `ffmpeg` → ADTS AAC → cached by the audio store at `audio_files/v2/{sectionId}.aac`. A two-speaker section is **one** multi-speaker request even when a speaker has a designed `voice_...` voice (the docs say to synthesize such turns individually, but that works fine in practice and keeps `|backchannel|` reactions voiced); with a single speaker backchannels are stripped. Sections are ≤2 speakers and ≤~800 bytes (`textSplitterService.js`), well under the ~300 s output limit, with a runtime abort at 300 s. A failed section serves transient silence and stays `pending` (retried next request). `voices.list` can only filter by `type`/`search`, so the ~2,100-voice library is crawled once (~4 s, 50/page) and cached in memory for 6 h, then filtered by language/gender locally. `ffmpeg` must be installed (it is in the Dockerfiles).
- **HLS** — one section = one segment. The playlist declares each generated section's real `actual_duration`; ungenerated sections use estimates plus a 120 s tail pad (players clip audio to the declared length). Plain ADTS segments need no `EXT-X-MAP`.
- Gemini API gotchas: empty text parts 400 the whole request (empty turns are dropped), `[`/`]` in text are rewritten to `<`/`>`, a solo speaker must not declare a second voice, a stalled stream can't be resumed, and the SDK's per-request `timeout` isn't reliably enforced (impose your own). `@google/genai` must be ≥ 2.25 for `enterprise: true` and the Voices API.
- CORS is dynamic (see `server.js`): allows localhost, `*.web.app`/`*.firebaseapp.com`, `*.a.run.app`, plus anything in `ALLOWED_ORIGINS` (comma-separated) — the deploy pipeline sets `ALLOWED_ORIGINS` to the frontend's Cloud Run URL after deploying it (see Step 10 in root `cloudbuild.yaml`).

Data model (Firestore collections): `titles` (incl. `voices`) → `chapters` (ordered by `order_index`) → `chapter_sections` (ordered by `section_index`, each with `status`/`audio_file_path`/`actual_duration`, synthesized on demand).

### Frontend (`frontend/src/`)

Small React Router app: `App.jsx` defines routes `/` (`pages/Home.jsx`), `/title/:id` (`pages/TitleDetail.jsx`), `/player/:chapterId` (`pages/Player.jsx`), plus `components/Login.jsx` and `context/AuthContext.jsx` for Firebase Auth state. `lib/api.js` is the sole fetch wrapper — it persists `client_id` from response headers into `localStorage` and re-attaches it as `X-Client-ID` on every request (mirrors the backend's cookie-based anonymous identity so it also works cross-origin). `lib/firebase.js` initializes Firebase from `VITE_FIREBASE_*` env vars; `TitleDetail.jsx` shows the cast (named/supporting) and lets you edit a character's custom voice or pick a library voice; `lib/googlePicker.js` backs the Google Docs import feature (`POST /api/google-docs/fetch` on the backend).

## Environment

Backend needs a `backend/.env` with `GOOGLE_APPLICATION_CREDENTIALS` (path to the GCP service account JSON — used for Firestore/GCS **and** the Gemini Enterprise API for casting + TTS; that account needs `roles/aiplatform.user` and the project needs the Gemini Enterprise API enabled; the project id comes from `GOOGLE_CLOUD_PROJECT`, the key file, or defaults to `ai-audio-book`), plus `ffmpeg` on `PATH`. `GEMINI_API_KEY` is no longer used. Frontend needs a `frontend/.env` with `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`. Neither file nor `*.json` credential files are committed (see `.gitignore`).

In Claude Code cloud sessions, `.claude/hooks/session-start.sh` (a `SessionStart` hook, registered in `.claude/settings.json`) handles this automatically: it decodes a `GOOGLE_APPLICATION_CREDENTIALS_BASE64` environment variable (set in the cloud environment's settings) into `~/credentials/service-account.json`, writes `GOOGLE_APPLICATION_CREDENTIALS` into both `$CLAUDE_ENV_FILE` and `backend/.env`, and installs+authenticates `gcloud`. This has to be a session-start hook rather than the environment's own setup script — `GOOGLE_APPLICATION_CREDENTIALS_BASE64` (and any other cloud-environment env var) is only ever injected into the `claude` process's own environment, never into the container entrypoint, `environment-manager`, or anything a setup script runs, since a setup script runs earlier in boot, before that process exists.

## Verification

`skills/ai-audio-book-verification/SKILL.md` has the manual end-to-end flow (create title → add chapter → generate audio → play) and troubleshooting steps (capture browser console logs / screenshot, report rather than deep-diagnosing UI issues in a subagent).
