# Setup Instructions for AI Hackathon Judge

## Prerequisites

1. OpenAI API Key - Get one from https://platform.openai.com/api-keys
2. Docker and Docker Compose installed

## Quick Start

### 1. Create Environment Files

**Backend Configuration (`backend/.env`):**
```env
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_REALTIME_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
OPENAI_REALTIME_SESSION_MODEL=gpt-4o-mini-transcribe
OPENAI_REALTIME_LANGUAGE=
TRANSCRIPTION_MODEL=whisper-1
SESSION_DATA_DIR=data/sessions
```

**Frontend Configuration (`frontend/.env`):**
```env
VITE_API_BASE_URL=http://localhost:8000
```

### 2. Build and Run

```bash
docker-compose up --build
```

### 3. Access the Application

- Frontend: http://localhost
- Backend API: http://localhost:8000
- Health Check: http://localhost:8000/health

## Troubleshooting

### "Failed to get realtime token" Error

This error occurs when:
1. OpenAI API key is missing or invalid
2. Backend is not running
3. Network connectivity issues

**Check:**
- Verify `OPENAI_API_KEY` is set in `backend/.env`
- Check backend logs: `docker logs ai-hackathon-backend`
- Ensure the backend is accessible at http://localhost:8000

### Build Issues

If Docker build fails:
1. Ensure all packages in `requirements.txt` are compatible
2. Check Docker has enough memory (at least 4GB recommended)
3. Run `docker system prune -a` to clean up old images

## Features

- Real-time speech-to-text using OpenAI Realtime API
- Presentation analysis with engagement metrics
- Live transcription with timestamps
- Video frame capture and analysis

