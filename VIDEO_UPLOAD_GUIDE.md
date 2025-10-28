# Video Upload Feature Guide

## Overview
The AI Hackathon Judge now supports uploading pre-recorded video presentations for analysis, in addition to live recording.

## How to Use

### 1. Choose Recording Mode
When you open the application, you'll see two options:
- **Live Recording**: Record your presentation in real-time using your camera and microphone
- **Upload Video**: Upload a pre-recorded video presentation

### 2. Upload Your Presentation Slides
- Drag and drop or browse to upload your `.pptx` file
- The slides will be parsed and used for context during analysis

### 3. Upload Your Video (if using Upload mode)
- Click on "Upload Video" mode
- Drag and drop or browse to select your video file
- Supported formats: MP4, WebM, MOV, AVI, MKV, M4V
- Maximum file size: 500MB
- The system will:
  - Extract frames from your video for visual analysis
  - Extract and transcribe the audio track
  - Process both for comprehensive feedback

### 4. Analysis Process
Once your video is uploaded, the system will:
1. Extract audio from the video
2. Transcribe the audio using OpenAI's Whisper API
3. Extract frames at regular intervals for visual analysis
4. Generate questions based on your presentation
5. Provide comprehensive feedback on:
   - Content quality
   - Delivery style
   - Visual presentation
   - Audience engagement (if visible in video)

## Features

### Video Processing
- **Audio Extraction**: Automatically extracts audio track from video
- **Frame Extraction**: Captures frames every 5 seconds for visual analysis
- **Transcription**: Converts speech to text for content analysis
- **Multi-format Support**: Handles various video formats

### Analysis Components
- **Content Analysis**: Evaluates the substance of your presentation
- **Delivery Analysis**: Assesses speaking pace, clarity, and engagement
- **Visual Analysis**: Reviews slides and presenter appearance
- **Q&A Preparation**: Generates potential questions judges might ask

## Technical Details

### Frontend Components
- `VideoUpload.tsx`: React component for video upload interface
- `videoTranscriptionService.ts`: Service for handling video transcription
- Frame extraction using HTML5 Canvas API

### Backend Support
- Enhanced `/transcribe` endpoint accepts both audio and video files
- FFmpeg integration for audio extraction from video
- Support for multiple video formats

### Processing Flow
1. Video file uploaded to frontend
2. Frames extracted client-side using Canvas API
3. Video sent to backend for audio extraction
4. Audio transcribed using OpenAI Whisper
5. Transcription and frames analyzed for feedback

## Tips for Best Results

1. **Video Quality**
   - Use good lighting and clear audio
   - Ensure your face is visible for engagement analysis
   - Keep file size under 500MB

2. **Content**
   - Include both presenter view and slides if possible
   - Speak clearly and at a moderate pace
   - Include audience reactions if available

3. **Format**
   - MP4 format recommended for best compatibility
   - 720p or 1080p resolution ideal
   - Ensure audio track is included

## Troubleshooting

### Video Not Processing
- Check file size (must be under 500MB)
- Ensure video has an audio track
- Try converting to MP4 format

### Transcription Issues
- Verify audio quality in the video
- Check that speech is clear and audible
- Ensure video has audio track

### Frame Extraction Failed
- Verify video codec compatibility
- Try a different browser (Chrome recommended)
- Check browser console for errors

## API Endpoints

### POST /transcribe
- Accepts both audio and video files
- Automatically detects file type
- Extracts audio from video if needed
- Returns transcription with timestamps

## Environment Variables
No additional environment variables needed - uses existing OpenAI API key configuration.
