# Direct Frontend-Backend Connection Setup

## Overview
The system is now configured for direct communication between frontend and backend without using nginx as a proxy.

## Architecture

```
Browser (http://localhost:3000)
    ↓
Frontend Container (Vite Dev Server :3000)
    ↓
Backend Container (FastAPI :8000)
    ↓
OpenAI APIs
```

## Access Points

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs

## Configuration Changes

### 1. Docker Compose
- Frontend port changed from `80` to `3000`
- Frontend runs Vite dev server instead of nginx

### 2. Frontend Dockerfile
- Removed nginx production build
- Now runs `npm run dev` with Vite
- Exposes port 3000

### 3. Environment Variables
- `frontend/.env`:
  - `VITE_API_BASE_URL=http://localhost:8000`
  
### 4. CORS Configuration
- Backend allows all origins (`*`)
- Supports WebSocket connections
- No proxy headers needed

## Benefits of Direct Connection

1. **Simpler Development**
   - Hot module replacement (HMR) works
   - Easier debugging
   - Direct API calls visible in browser DevTools

2. **Faster Iteration**
   - No nginx configuration needed
   - Changes reflect immediately
   - Better error messages

3. **Transparent Communication**
   - See actual API endpoints
   - Direct WebSocket connections
   - Clear network traffic in browser

## API Endpoints

All API calls go directly to `http://localhost:8000`:

- `POST /realtime/token` - Get WebSocket token
- `WS /realtime/ws` - WebSocket for transcription
- `POST /transcribe` - Audio transcription
- `POST /sessions/{id}/videos` - Upload videos
- `GET /sessions/{id}/analysis` - Get analysis

## WebSocket Connection

Frontend connects directly to backend WebSocket:
```javascript
const wsUrl = 'ws://localhost:8000/realtime/ws?token=...'
const ws = new WebSocket(wsUrl)
```

## Testing

1. Start the services:
   ```bash
   docker compose up -d
   ```

2. Access the frontend:
   ```
   http://localhost:3000
   ```

3. Check logs:
   ```bash
   docker logs ai-hackathon-frontend -f
   docker logs ai-hackathon-backend -f
   ```

## Switching Back to Proxy

If you want to use nginx proxy again:
1. Revert `docker-compose.yml` port to `80`
2. Revert `frontend/Dockerfile` to use nginx
3. Set `VITE_API_BASE_URL=` (empty) in `frontend/.env`

## Notes

- CORS is enabled on backend for all origins
- Frontend runs in development mode (not optimized for production)
- Hot reload is enabled for both frontend and backend
