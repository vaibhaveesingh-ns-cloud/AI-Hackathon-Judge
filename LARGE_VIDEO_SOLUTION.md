# Large Video Upload Solution

## Problem
The "413 Request Entity Too Large" error occurs when uploading videos larger than the server's configured maximum request size limit.

## Solution Implemented

### 1. Backend Configuration Updates
- **Increased request size limits** to 1GB in the backend
- **Added uvicorn parameters** to handle large requests
- **Created configuration file** (`backend/app/config.py`) for centralized size limits
- **Updated Docker configuration** with environment variables for request limits

### 2. Frontend Updates  
- **Increased max file size** from 500MB to 1GB
- **Added file size validation** before upload
- **Improved error messages** for size-related issues
- **Added progress indicators** for large file processing

### 3. Docker Configuration
- Added environment variables:
  - `MAX_REQUEST_SIZE=1073741824` (1GB in bytes)
  - `CLIENT_MAX_BODY_SIZE=1024m`
- Created startup script with proper uvicorn configuration

## File Size Limits

| File Type | Maximum Size | Notes |
|-----------|--------------|-------|
| Video Files | 1GB (1024MB) | Supports MP4, WebM, MOV, AVI, MKV |
| Audio Files | 100MB | Extracted from video or uploaded directly |
| PPTX Files | 50MB | Presentation slides |

## For Videos Larger Than 1GB

If you need to analyze videos larger than 1GB, consider these alternatives:

### Option 1: Compress Your Video
Use video compression tools to reduce file size while maintaining quality:

```bash
# Using ffmpeg to compress video
ffmpeg -i input.mp4 -vcodec h264 -acodec aac -crf 28 output.mp4

# For more aggressive compression (lower quality)
ffmpeg -i input.mp4 -vcodec h264 -acodec aac -crf 35 -preset fast output.mp4
```

### Option 2: Trim Your Video
Extract the most important segment:

```bash
# Extract 10 minutes starting from 2 minutes
ffmpeg -i input.mp4 -ss 00:02:00 -t 00:10:00 -c copy output.mp4
```

### Option 3: Reduce Resolution
Lower the video resolution:

```bash
# Scale to 720p
ffmpeg -i input.mp4 -vf scale=1280:720 -c:a copy output.mp4

# Scale to 480p for smaller size
ffmpeg -i input.mp4 -vf scale=854:480 -c:a copy output.mp4
```

### Option 4: Extract Audio Only
If visual analysis isn't critical, extract just the audio:

```bash
# Extract audio as MP3
ffmpeg -i input.mp4 -vn -acodec mp3 -ab 128k output.mp3
```

## Recommended Video Settings

For optimal processing and upload:

- **Format**: MP4 (H.264 codec)
- **Resolution**: 720p or 1080p
- **Bitrate**: 2-4 Mbps for 720p, 4-8 Mbps for 1080p
- **Audio**: AAC codec, 128-192 kbps
- **Frame Rate**: 24-30 fps

## Troubleshooting

### Still Getting 413 Error?
1. Clear browser cache and cookies
2. Check video file size: `ls -lh your-video.mp4`
3. Ensure Docker containers are rebuilt: `docker compose down && docker compose up --build`
4. Check backend logs: `docker compose logs backend`

### Upload Timing Out?
For very large files (500MB+), the upload may take several minutes depending on your internet connection:
- **100 Mbps connection**: ~40-80 seconds for 500MB
- **50 Mbps connection**: ~80-160 seconds for 500MB
- **10 Mbps connection**: ~400-800 seconds for 500MB

### Memory Issues?
Large videos require significant memory for processing:
- Ensure Docker has at least 4GB RAM allocated
- Close other applications during processing
- Consider processing during off-peak hours

## Technical Details

### Backend Changes
- `backend/start.sh`: Startup script with uvicorn configuration
- `backend/app/config.py`: Configuration for size limits
- `backend/Dockerfile`: Updated to use startup script
- `docker-compose.yml`: Added environment variables

### Frontend Changes
- `components/VideoUpload.tsx`: Updated size validation to 1GB
- `services/videoTranscriptionService.ts`: Better error handling

### Processing Flow
1. Video uploaded to frontend (client-side validation)
2. Frames extracted using Canvas API
3. Video sent to backend via multipart form data
4. Backend extracts audio using ffmpeg
5. Audio transcribed using OpenAI Whisper API
6. Transcription and frames analyzed

## Performance Tips

1. **Use modern browsers**: Chrome, Firefox, or Edge for best compatibility
2. **Stable internet**: Ensure stable connection for large uploads
3. **Close unnecessary tabs**: Free up browser memory
4. **Wait for processing**: Large videos may take 2-5 minutes to fully process

## Future Improvements

Potential enhancements for handling even larger videos:
- Chunked upload implementation
- Video streaming analysis
- Cloud storage integration (S3, GCS)
- Background job processing with queues
- Video preprocessing service
