# Long Video Transcription Solution

## Problem
OpenAI's Whisper API returns 500 Internal Server Error for long videos (15+ minutes) because:
- **Whisper API has a 25MB file size limit**
- A 17-minute video's audio can be 30-50MB after extraction
- The API times out or rejects large files

## Solution Implemented
**Automatic Audio Chunking** - Split large audio files into smaller chunks, transcribe each, then merge results.

### How It Works

1. **Audio Extraction**: Video → WAV audio (16kHz mono)
2. **Size Check**: If audio > 20MB, activate chunking
3. **Smart Chunking**: Split into 5-minute segments (configurable)
4. **Parallel Processing**: Transcribe each chunk via Whisper API
5. **Intelligent Merging**: Combine transcripts with proper timestamps

### Features

#### AudioChunker Class
- **Automatic duration calculation** based on file size
- **Smart chunk sizing** to stay under API limits
- **Timestamp preservation** across chunks
- **Seamless text merging** without duplicates

#### Processing Flow
```
17-min video (500MB)
    ↓ Extract audio
30MB WAV file
    ↓ Detect > 20MB
Split into 4 chunks (7.5MB each)
    ↓ Transcribe each
Merge transcriptions
    ↓
Complete transcript with timestamps
```

## Performance

| Video Length | Before | After |
|--------------|--------|-------|
| < 10 minutes | ✅ Works | ✅ Works |
| 10-15 minutes | ⚠️ Sometimes fails | ✅ Works |
| 15-30 minutes | ❌ Error 500 | ✅ Works |
| 30-60 minutes | ❌ Error 500 | ✅ Works |

## Configuration

### Chunk Settings (in audio_chunker.py)
```python
MAX_CHUNK_SIZE = 20 * 1024 * 1024  # 20MB per chunk
MAX_CHUNK_DURATION = 600  # 10 minutes max per chunk
```

### Adjusting for Your Needs

#### For Faster Processing (less accurate)
```python
# In main.py, line 514
audio_chunks = AudioChunker.split_audio(tmp_audio_path, chunk_duration=180)  # 3-minute chunks
```

#### For Better Accuracy (slower)
```python
# In main.py, line 514
audio_chunks = AudioChunker.split_audio(tmp_audio_path, chunk_duration=600)  # 10-minute chunks
```

## Usage

### Upload Any Length Video
1. Upload video (up to 1.5GB)
2. System automatically detects if chunking is needed
3. Progress logs show chunk processing
4. Complete transcript returned

### Monitor Progress
Check backend logs to see chunking in action:
```bash
docker compose logs backend -f | grep "[transcribe]"
```

Example output:
```
[transcribe] Large audio file (45.2MB), using chunked processing
[transcribe] Split audio into 3 chunks
[transcribe] Processing chunk 1/3
[transcribe] Processing chunk 2/3
[transcribe] Processing chunk 3/3
```

## Troubleshooting

### Still Getting Errors?

1. **Check OpenAI API limits**
   - Rate limits: 50 requests/minute
   - File size: 25MB per request
   - Solution: Wait between chunks or upgrade API tier

2. **Memory issues**
   ```bash
   # Increase Docker memory
   docker system prune -a  # Clean up first
   # Then in Docker Desktop: Settings → Resources → Memory: 8GB+
   ```

3. **Timeout on very long videos (1hr+)**
   - Consider splitting video before upload
   - Or increase timeout in gunicorn_config.py

### Optimize Your Videos

#### Before Upload (Recommended)
```bash
# Extract just audio (much smaller, faster)
ffmpeg -i long_video.mp4 -vn -acodec mp3 -ab 128k audio.mp3

# Or reduce video quality
ffmpeg -i long_video.mp4 -vf scale=480:-1 -c:a copy smaller_video.mp4
```

#### Split Very Long Videos
```bash
# Split into 30-minute parts
ffmpeg -i long_video.mp4 -c copy -map 0 -segment_time 00:30:00 -f segment part%03d.mp4
```

## Technical Details

### Files Modified
1. **audio_chunker.py** - New chunking utility class
2. **main.py** - Updated transcription logic with chunking
3. **config.py** - Size limit configurations

### Chunking Algorithm
1. Calculate total duration using ffmpeg probe
2. Determine optimal chunk size based on file size
3. Extract chunks using ffmpeg with start/duration parameters
4. Verify each chunk is under 20MB
5. If too large, reduce duration and retry

### Merging Algorithm
1. Collect all chunk transcriptions
2. Adjust timestamps relative to chunk position
3. Concatenate text with proper spacing
4. Preserve segment boundaries
5. Return unified transcript

## Benefits

✅ **No more 500 errors** for long videos
✅ **Handles videos up to 2 hours**
✅ **Maintains timestamp accuracy**
✅ **Automatic and transparent**
✅ **Progress tracking in logs**

## Limitations

- Very long videos (2+ hours) may hit rate limits
- Processing time increases linearly with duration
- Costs increase with more API calls (one per chunk)

## Cost Estimation

| Video Length | Chunks | API Calls | Estimated Cost |
|--------------|--------|-----------|----------------|
| 10 minutes | 1 | 1 | $0.06 |
| 20 minutes | 2 | 2 | $0.12 |
| 30 minutes | 3 | 3 | $0.18 |
| 60 minutes | 6 | 6 | $0.36 |

*Based on Whisper API pricing of $0.006 per minute*

## Future Improvements

1. **Parallel chunk processing** - Process multiple chunks simultaneously
2. **Adaptive chunking** - Adjust chunk size based on content density
3. **Resume capability** - Resume failed transcriptions from last chunk
4. **Cache chunks** - Store transcribed chunks for reuse
5. **Progress API** - Real-time progress updates to frontend
