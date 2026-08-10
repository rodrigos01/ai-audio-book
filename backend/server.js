require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const authMiddleware = require('./auth');
const clientIdMiddleware = require('./middleware/clientId');
const audioFileStore = require('./stores/audioFileStore');
const { debugLog } = require('./services/logger');

const titleRoutes = require('./routes/titleRoutes');
const chapterRoutes = require('./routes/chapterRoutes');
const voiceRoutes = require('./routes/voiceRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();
const PORT = process.env.PORT || 3005;

// Basic health check
app.get('/health', (req, res) => res.status(200).send('OK'));

const allowedOrigins = [
  'http://localhost:*', 'https://ai-audio-book-883622140264.us-central1.run.app'
];

if (process.env.ALLOWED_ORIGINS) {
  const envOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  allowedOrigins.push(...envOrigins);
}

// Serve frontend static assets before CORS and auth
const frontendDist = path.resolve(__dirname, '../frontend/dist');
debugLog(`Serving frontend from: ${frontendDist}`);

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    }
  }));
} else {
  debugLog(`Frontend dist not found at: ${frontendDist}`);
}

if (fs.existsSync(audioFileStore.samplesDir)) {
  app.use('/samples', express.static(audioFileStore.samplesDir));
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);

    const isLocalhost = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
    const isFirebase = origin.endsWith('.web.app') || origin.endsWith('.firebaseapp.com');
    const isCloudRun = origin.endsWith('.run.app');

    if (isLocalhost || isFirebase || isCloudRun) {
      return callback(null, true);
    }

    if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
      return callback(null, true);
    }
    console.log(`CORS blocked for origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(authMiddleware);
app.use(clientIdMiddleware);

// API Route Registration
app.use('/api/titles', titleRoutes);
app.use('/api/chapters', chapterRoutes);
app.use('/api/voices', voiceRoutes);
app.use('/api/auth', authRoutes);

// SPA fallback for non-API GET requests
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API not found' });
  const indexFile = path.join(frontendDist, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).send('Frontend not built. Please run npm run build in frontend folder.');
  }
});

app.listen(PORT, () => {
  debugLog(`Server listening on port ${PORT}`);
});
