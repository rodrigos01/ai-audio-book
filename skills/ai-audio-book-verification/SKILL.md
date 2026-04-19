# AI Audiobook Verification Skill

**Description**: Instructions and tools for subagents to verify the AI Audiobook application (Frontend, Express Backend, Firestore, and GCS).

## Application Overview

The AI Audiobook app is a multi-service application:
- **Frontend**: Vite + React, communicates with `/api/*`.
- **Backend**: Node.js Express server on port 3005 (local) or 8080 (Cloud Run).
- **Database**: Google Cloud Firestore (Decoupled Repository Pattern).
- **Storage**: GCS Bucket mounted via FUSE to `/app/storage` (local: configurable).
- **TTS**: Google Cloud Text-to-Speech via Service Account credentials.

---

## Verification Procedures

### 1. Manual User Flow (Local)

**Before starting:**
1. make the sure the backend is running: `cd /home/rodrigo/dev/node/ai-audio-book/backend && npm run dev`
2. make the sure the frontend is running: `cd /home/rodrigo/dev/node/ai-audio-book/frontend && npm run dev`

1.  **Library Check**: Navigate to the frontend url, which will be indicated in the "npm run" output. Verify initial loading state.
2.  **Creation**: Use "Create Title" with a descriptive name.
3.  **Chapters**: Click the book, fill in the "Add Chapter" form.
4.  **Audio Generation**: Monitor "Generate Chapter Audio" request completion.
5.  **Playback**: Open the player and wait for the progress bar to advance.

### 2. Automated Diagnostics
Execute the scripts in the `scripts/` directory:
- `verify-health.sh`: Checks API availability.
- `check-logs.sh`: Extracts error messages from `server.log`.

### 3. Error Recognition & Troubleshooting

#### Troubleshooting Strategy
If you encounter a blank screen, a persistent loading state, or any behavior that deviates from the expected flow:
1.  **Capture Console Logs**: Immediately run `capture_browser_console_logs`.
2.  **Screenshot**: Capture a screenshot to document the UI state.
3.  **Report & End**: Do not attempt to fix or deeply diagnose the root cause if it requires code changes. Simply report the observed behavior and provide the logs/screenshots to the main agent, then end your session.

---

## Reporting Protocol

When reporting back to the main agent, include:
- **Environment**: Local or Production (URL).
- **Operation**: Which step failed (e.g. "Chapter Creation").
- **Error Logs**: Exact error snippet from `server.log` or browser console.
- **Index Status**: If a Firestore error, include the provided index creation link.
