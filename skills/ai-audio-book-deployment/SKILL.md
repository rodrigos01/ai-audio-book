# AI Audiobook Deployment Skill

**Description**: Guidelines for deploying the separated Frontend and Backend services to Google Cloud Run, optimizing build times by deploying only modified modules, and running full deployments in parallel.

---

## Deployment Rules

To optimize build and deploy cycles, only deploy the components you have modified:

### 1. Backend-Only Changes
* **When to use:** If you only changed files under the `backend/` directory or updated server configuration.
* **Commands:**
  * Root: `npm run deploy-backend`
  * Backend directory: `npm run deploy`

### 2. Frontend-Only Changes
* **When to use:** If you only changed files under the `frontend/` directory.
* **Commands:**
  * Root: `npm run deploy-frontend`
  * Frontend directory: `npm run deploy`

### 3. Full-Stack Changes (Both Modified)
* **When to use:** If changes have been made to both layers.
* **Sequential Command:**
  * Root: `npm run deploy` (deploys backend first, retrieves its URL, builds the frontend, and updates CORS).
* **Parallel Command:**
  * Root: `npm run deploy:parallel` (runs frontend and backend builds simultaneously to save time, assuming the backend has been deployed at least once before so Cloud Run service endpoints are stable).

---

## Parallel Deployment Optimization
When executing a full-stack deploy, you can invoke the builds in parallel:
```bash
npm run deploy:parallel
```
*Note:* The frontend build retrieves the backend URL using `gcloud run services describe`. As long as the backend service (`ai-audio-book-api`) has already been initially created, the service URL is stable. The parallel build will build both images and redeploy them at the same time, reducing build times.
