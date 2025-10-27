# OpenAI Realtime API Model Configuration

## Correct Model Names

### For Realtime API (WebSocket-based transcription)
- **Session Model**: `gpt-4o-realtime-preview-2024-12-17`
  - This is the ONLY model that supports realtime transcription
  - Other available versions:
    - `gpt-4o-realtime-preview-2024-10-01`
    - `gpt-4o-realtime-preview`

### For Standard Transcription (REST API)
- **Transcription Model**: `whisper-1`
  - Used for `/transcribe` endpoint
  - Supports file uploads

## Common Errors

### ❌ INCORRECT Models (These don't exist)
- `gpt-4o-mini-transcribe` - Not a valid model
- `gpt-4o-transcribe` - Not a valid model
- Any model with "mini" in realtime context

### ✅ CORRECT Configuration

**backend/.env:**
```env
OPENAI_REALTIME_SESSION_MODEL=gpt-4o-realtime-preview-2024-12-17
TRANSCRIPTION_MODEL=whisper-1
```

## How Realtime API Works

1. **Session Creation**: 
   - POST to `/v1/realtime/sessions`
   - Specify the session model (`gpt-4o-realtime-preview-2024-12-17`)
   - Get back a session token

2. **WebSocket Connection**:
   - Connect to `wss://api.openai.com/v1/realtime`
   - Use the session token for authentication
   - Model is already configured in the session

3. **Transcription**:
   - The session model handles both:
     - Speech-to-text (transcription)
     - Text generation (if needed)
   - No separate transcription model needed

## Important Notes

- The Realtime API uses a single model for all operations
- Don't specify a separate transcription model in the session config
- The model parameter should NOT be in the WebSocket URL when using sessions
- Language can be specified in `input_audio_transcription` config if needed

## Troubleshooting

If you see errors like:
- "Model 'xxx' is not supported in realtime mode" - You're using an invalid model name
- "Failed to create realtime transcription session" - Check API key and model name
- WebSocket closes immediately - Model configuration issue or invalid token

## Testing

Test if your API key has access to Realtime models:
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY" | grep "gpt-4o-realtime"
```

Expected output should include:
- `gpt-4o-realtime-preview-2024-12-17`
- `gpt-4o-realtime-preview-2024-10-01`
- `gpt-4o-realtime-preview`
