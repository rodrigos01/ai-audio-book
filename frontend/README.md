# AI Audio Book Frontend

This directory contains the single-page React web application for the AI Audio Book platform, built with **React**, **Vite**, **Vanilla CSS / Material Design Web Components**, and **Firebase SDK**.

---

## Key Features

1. **Audiobook Library & Management**:
   - Create, rename, delete, and view audiobooks.
   - Support for both **Basic Tier** (Chirp3 HD voices with SSML control) and **Pro Tier** (Gemini 3.1 Flash Multi-Speaker TTS with natural performance prompts).

2. **Single-Request Chapter Import**:
   - Create chapters from raw text input, local file upload (`.txt`, `.md`), or directly from **Google Docs API** using Google Drive Picker.
   - Automatic AI Voice Casting via Gemini 3.6 Flash.

3. **Multi-Speaker Character Casting**:
   - Visual character voice mapping interface.
   - Filter voices by gender and vocal performance style.
   - Inline voice preview audio samples.

4. **Continuous Audio Player**:
   - Pre-calculated section timing offsets (`estimated_start_time`, `estimated_duration`) for smooth playback.
   - Lock-screen and background media controls via custom `useMediaSession` hook.

5. **Offline Playback & Caching**:
   - Prepare and download full chapter audio to local browser storage using **IndexedDB** (`lib/offlineStorage.js`).
   - Seamless offline playback fallback when network connectivity is absent.

---

## Directory Structure

```
frontend/
├── src/
│   ├── components/       # Reusable UI components (Navbar, VoiceSelector, etc.)
│   ├── context/          # React Context Providers (AuthContext.jsx, DownloadsContext.jsx)
│   ├── lib/              # Core client libraries
│   │   ├── api.js        # Backend REST API wrapper
│   │   ├── firebase.js   # Firebase Client SDK setup
│   │   ├── googlePicker.js # Google Drive / Docs Picker integration
│   │   └── offlineStorage.js # IndexedDB storage for offline MP3 files
│   ├── pages/            # Main application views
│   │   ├── Home.jsx      # Library view & book creation
│   │   ├── TitleDetail.jsx # Book management, chapter listing & character casting
│   │   └── Player.jsx    # Audio player with progress scrub & lockscreen controls
│   ├── App.jsx           # Main App routes & layout wrapper
│   ├── index.css         # Global CSS design tokens & Material theme
│   └── main.jsx          # React DOM entry point
├── public/               # Static assets & public icons
├── index.html            # HTML template with Google Fonts & Material Symbols
└── vite.config.js        # Vite bundler configuration
```

---

## Development Setup

```bash
# Install dependencies
npm install

# Start development server (HMR enabled)
npm run dev

# Lint code
npm run lint

# Build for production
npm run build
```
