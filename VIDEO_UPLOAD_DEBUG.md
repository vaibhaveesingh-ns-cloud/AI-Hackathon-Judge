# Video Upload Debugging Guide

## Error: "something went wrong reading your request"

This error from OpenAI's API typically means the audio data is corrupted or in an invalid format.

## Common Causes & Solutions

### 1. File Type Detection Issue
The backend might not be correctly detecting the video file type.

**Check in browser console:**
```javascript
// When uploading, check what's being sent
console.log('File name:', file.name);
console.log('File type:', file.type);
console.log('File size:', file.size);
```

### 2. FFmpeg Audio Extraction Issue
The backend uses FFmpeg to extract audio from video. Issues can occur if:
- Video has no audio track
- Video codec is not supported
- FFmpeg fails silently

**To test manually:**
```bash
# Test FFmpeg extraction locally
ffmpeg -i your_video.mp4 -ac 1 -ar 16000 -acodec pcm_s16le -f wav output.wav
```

### 3. File Size Issues
Even though we increased limits, very large files might still cause issues.

**Check file size:**
- Files over 100MB might take long to process
- Files over 500MB might timeout

### 4. Content Type Mismatch
Browser might send wrong content-type for the video file.

## Debugging Steps

### Step 1: Check Backend Logs
```bash
docker compose logs backend -f
```
Look for lines starting with `[transcribe]` to see what the backend receives.

### Step 2: Test with Small Video
Try with a very small video file (< 10MB) first:
```bash
# Create a test video with audio
ffmpeg -f lavfi -i testsrc=duration=10:size=320x240:rate=30 \
       -f lavfi -i sine=frequency=1000:duration=10 \
       -c:v libx264 -c:a aac test_video.mp4
```

### Step 3: Test Backend Directly
Use the test script:
```bash
python test_video_upload.py your_video.mp4
```

Or use curl:
```bash
curl -X POST http://localhost:8000/transcribe \
  -F "audio=@your_video.mp4;type=video/mp4" \
  -F "start_ms=0" \
  -F "duration_ms=0"
```

### Step 4: Check Video Format
Ensure your video:
- Has an audio track: `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 your_video.mp4`
- Is a supported format (MP4, WebM, MOV)
- Audio codec is standard (AAC, MP3, etc.)

## Quick Fixes to Try

### 1. Convert Video to Standard Format
```bash
# Convert to standard MP4 with AAC audio
ffmpeg -i input_video.any -c:v libx264 -c:a aac -strict experimental output.mp4
```

### 2. Extract Audio First
```bash
# Extract just audio
ffmpeg -i video.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 audio.wav
```
Then upload the WAV file instead.

### 3. Use Shorter Video
If your video is long, try with just the first minute:
```bash
ffmpeg -i long_video.mp4 -t 60 -c copy short_video.mp4
```

## Backend Fixes Applied

1. **Added detailed logging** to track file processing
2. **Improved error messages** from FFmpeg
3. **Better cleanup** of temporary files
4. **Direct video file handling** without browser extraction

## Frontend Fixes Applied

1. **Removed browser audio extraction** (unreliable)
2. **Send video directly** to backend
3. **Better file metadata** handling
4. **Improved error messages**

## If Still Not Working

1. **Check OpenAI API Key**: Ensure it's valid and has access to Whisper API
2. **Try different video format**: MP4 with H.264 video and AAC audio works best
3. **Check Docker resources**: Ensure Docker has enough memory (4GB+)
4. **Test with audio file**: Try uploading just an audio file (MP3/WAV) to isolate the issue

## Test Files

Create these test files to isolate the issue:

### 1. Test Audio (WAV)
```bash
ffmpeg -f lavfi -i sine=frequency=1000:duration=5 -ar 16000 test.wav
```

### 2. Test Video (MP4)
```bash
ffmpeg -f lavfi -i testsrc=duration=5:size=320x240:rate=30 \
       -f lavfi -i sine=frequency=1000:duration=5 \
       -c:v libx264 -c:a aac test.mp4
```

### 3. Test Video (WebM)
```bash
ffmpeg -f lavfi -i testsrc=duration=5:size=320x240:rate=30 \
       -f lavfi -i sine=frequency=1000:duration=5 \
       -c:v libvpx -c:a libvorbis test.webm
```

Upload each to identify which formats work.
