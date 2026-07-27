# Lightweight Dockerfile for the AI Audio Book API service
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV STORAGE_BASE_PATH=/app/storage

# Backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

# Copy backend source (excluding sensitive files via .dockerignore)
COPY backend/ ./backend/

# Expose port and start
EXPOSE 8080
WORKDIR /app/backend

# Use absolute path for credentials to avoid confusion
ENV GOOGLE_APPLICATION_CREDENTIALS=/app/backend/ai-audio-book-key.json

CMD ["node", "server.js"]
