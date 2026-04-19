# Multi-stage build for web-walk application

# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Final image with Node.js, Python, and FFmpeg
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    supervisor \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Setup Python virtual environment and install dependencies
COPY walker/requirements.txt /app/walker/
RUN python3 -m venv /app/venv && \
    /app/venv/bin/pip install --upgrade pip && \
    /app/venv/bin/pip install --no-cache-dir -r /app/walker/requirements.txt

# Copy Python walker
COPY walker/ /app/walker/

# Install Node.js dependencies
COPY server/package*.json /app/server/
WORKDIR /app/server
RUN npm install --production

# Copy server code
COPY server/ /app/server/

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy supervisor config
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create data directory
RUN mkdir -p /data/frames /data/videos /data/jobs

# Environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV OUTPUT_DIR=/data
ENV GOOGLE_API_KEY=
ENV PYTHONUNBUFFERED=1
ENV TZ=Europe/Bratislava

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

# Start with supervisor
WORKDIR /app
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
