import { resolveBackendUrl } from './openaiService';

export interface VideoTranscriptionResult {
  text: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export class VideoTranscriptionService {
  private apiUrl: string;

  constructor() {
    this.apiUrl = resolveBackendUrl('/transcribe');
  }

  /**
   * Extract audio from video and transcribe it
   */
  async transcribeVideo(videoFile: File): Promise<VideoTranscriptionResult> {
    console.log('[VideoTranscription] Starting video transcription for:', videoFile.name);
    
    try {
      // Send video file directly to backend for audio extraction and transcription
      // The backend will use ffmpeg to properly extract audio
      const formData = new FormData();
      
      // Ensure the file has a proper extension for backend detection
      const fileName = videoFile.name || 'video.mp4';
      
      // Create a new File object with the correct type if needed
      const fileToSend = new File([videoFile], fileName, {
        type: videoFile.type || 'video/mp4'
      });
      
      console.log('[VideoTranscription] Sending file:', fileName, 'type:', fileToSend.type, 'size:', fileToSend.size);
      
      formData.append('audio', fileToSend, fileName);
      formData.append('start_ms', '0');
      formData.append('duration_ms', '0'); // Let backend determine duration
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        if (response.status === 413) {
          throw new Error('Video file is too large. Please use a video smaller than 1GB or compress your video.');
        }
        const errorText = await response.text();
        throw new Error(`Transcription failed: ${response.statusText} - ${errorText}`);
      }
      
      const result = await response.json();
      
      console.log('[VideoTranscription] Transcription complete:', result.text?.length || 0, 'characters');
      
      return {
        text: result.text || '',
        segments: result.segments || [],
      };
    } catch (error) {
      console.error('[VideoTranscription] Error:', error);
      throw error;
    }
  }

}

export default VideoTranscriptionService;
