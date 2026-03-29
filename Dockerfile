# Multi-stage Dockerfile for AI Audio Book
# Stage 1: Build the React frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Final image with Node.js backend
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

# Copy built frontend from Stage 1
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Expose port and start
EXPOSE 8080
WORKDIR /app/backend

# Use absolute path for credentials to avoid confusion
ENV GOOGLE_APPLICATION_CREDENTIALS=/app/backend/ai-audio-book-key.json

CMD ["node", "server.js"]
