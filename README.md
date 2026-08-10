# AI Audio Book Platform

A modern, full-stack AI audiobook generation and streaming web platform that transforms written text and Google Documents into dramatic, multi-speaker audio experiences.

Powered by **Google Cloud Text-to-Speech (Chirp3 HD & Gemini Multi-Speaker TTS)**, **Gemini 3.6 Flash AI Voice Casting**, **Firebase Firestore**, and **React + Vite**.

---

## Key Features

- 🎭 **AI Voice Casting**: Automatically analyzes chapter text using Gemini to identify characters and assign consistent, stylistically appropriate voices across chapters.
- 🎙️ **Dual TTS Tiers**:
  - **Basic Tier**: High-definition Chirp3 SSML synthesis with paragraph control.
  - **Pro Tier**: Gemini 3.1 Flash Multi-Speaker TTS with natural performance prompts and vocal emotion cues.
- 📄 **Google Docs Integration**: Pick and import Google Documents directly into audiobooks in a single atomic request.
- 🔊 **Chunked Audio Streaming**: Low-latency streaming server synthesizing section audio on demand with pre-calculated section timing.
- 📲 **Offline Playback**: Download and store chapter audio in IndexedDB for playback without internet connectivity.
- 🔐 **Hybrid Authentication**: Seamless guest experience with persistent anonymous Client ID cookies, plus instant Firebase Google Authentication and guest-book claiming.

---

## Repository Structure

```
ai-audio-book/
├── backend/              # Express Node.js backend server (MVC architecture)
│   ├── routes/           # Express router presentation layer & HTTP error translation
│   ├── controllers/      # Pure, Express-free business logic controllers
│   ├── stores/           # Firestore DB & Audio File storage managers
│   ├── services/         # Google Cloud TTS, Gemini AI Casting, Google Docs API, Text Splitter
│   ├── middleware/       # Firebase Authentication & Client ID cookie assignment
│   └── utils/            # Semantic domain error classes (ValidationError, NotFoundError, etc.)
├── frontend/             # Single-Page React application (Vite + Material Web Components)
│   ├── src/
│   │   ├── pages/        # Home, TitleDetail, and Player pages
│   │   ├── context/      # AuthContext & DownloadsContext providers
│   │   ├── lib/          # REST API client, Firebase SDK, Google Picker, IndexedDB offline storage
│   │   └── components/   # UI components & Material Web bindings
│   └── public/           # Static web assets
└── firestore.rules       # Firebase Firestore security access rules
```

---

## Quick Start

### 1. Backend Setup

```bash
cd backend
npm install

# Copy & configure environment variables
cp .env.example .env
```

Ensure your `.env` contains:
```ini
PORT=3005
STORAGE_BASE_PATH=./storage
GOOGLE_APPLICATION_CREDENTIALS=./your-service-account-key.json
GEMINI_API_KEY=AIzaSy...
```

Start the backend server:
```bash
npm run dev-backend
```

### 2. Frontend Setup

```bash
cd frontend
npm install

# Start Vite development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Architecture Documentation

- For detailed backend API endpoints, authentication middleware, and storage documentation, see [backend/README.md](file:///home/rodrigo/dev/node/ai-audio-book/backend/README.md).
- For detailed frontend component architecture, context providers, and offline storage details, see [frontend/README.md](file:///home/rodrigo/dev/node/ai-audio-book/frontend/README.md).
