import { TranscriptionEntry } from '../types';
import { getOpenAIApiKey } from '../utils/getOpenAIApiKey';

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  duration: number;
  language: string;
}

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

export class PostTranscriptionService {
  private apiKey: string;

  constructor() {
    this.apiKey = getOpenAIApiKey();
  }

  async transcribeAudio(audioBlob: Blob, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    console.log('[PostTranscription] Starting transcription of audio blob:', audioBlob.size, 'bytes');
    
    try {
      // Create form data for OpenAI Whisper API
      const formData = new FormData();
      
      // Convert blob to file
      const audioFile = new File([audioBlob], 'audio.webm', { 
        type: audioBlob.type || 'audio/webm' 
      });
      
      formData.append('file', audioFile);
      formData.append('model', 'whisper-1');
      formData.append('language', options?.language || 'en');
      formData.append('response_format', 'verbose_json'); // Get detailed segments
      
      if (options?.prompt) {
        formData.append('prompt', options.prompt);
      }

      // Call OpenAI Whisper API
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Transcription failed: ${error}`);
      }

      const result = await response.json();
      console.log('[PostTranscription] Transcription completed:', result);

      // Format the result
      const transcriptionResult: TranscriptionResult = {
        text: result.text,
        segments: result.segments || [],
        duration: result.duration || 0,
        language: result.language || 'en',
      };

      return transcriptionResult;
    } catch (error) {
      console.error('[PostTranscription] Error transcribing audio:', error);
      throw error;
    }
  }

  // Convert transcription result to TranscriptionEntry format for consistency
  convertToTranscriptionEntries(
    result: TranscriptionResult, 
    context: 'presentation' | 'q&a' = 'presentation'
  ): TranscriptionEntry[] {
    return result.segments.map(segment => ({
      speaker: 'user',
      text: segment.text.trim(),
      context,
      startMs: Math.round(segment.start * 1000),
      endMs: Math.round(segment.end * 1000),
    }));
  }

  // Generate a formatted transcript for display
  formatTranscript(result: TranscriptionResult): string {
    if (result.segments.length === 0) {
      return result.text;
    }

    return result.segments
      .map(segment => {
        const timestamp = this.formatTimestamp(segment.start);
        return `[${timestamp}] ${segment.text.trim()}`;
      })
      .join('\n\n');
  }

  private formatTimestamp(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // Save transcript to local storage for later viewing
  saveTranscript(sessionId: string, result: TranscriptionResult): void {
    const key = `transcript_${sessionId}`;
    const data = {
      ...result,
      timestamp: Date.now(),
      sessionId,
    };
    
    try {
      localStorage.setItem(key, JSON.stringify(data));
      console.log('[PostTranscription] Transcript saved to local storage:', key);
    } catch (error) {
      console.error('[PostTranscription] Failed to save transcript:', error);
    }
  }

  // Load transcript from local storage
  loadTranscript(sessionId: string): TranscriptionResult | null {
    const key = `transcript_${sessionId}`;
    
    try {
      const data = localStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data);
        console.log('[PostTranscription] Transcript loaded from local storage:', key);
        return parsed;
      }
    } catch (error) {
      console.error('[PostTranscription] Failed to load transcript:', error);
    }
    
    return null;
  }

  // Get all saved transcripts
  getAllSavedTranscripts(): Array<{ sessionId: string; timestamp: number; text: string }> {
    const transcripts = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('transcript_')) {
        try {
          const data = JSON.parse(localStorage.getItem(key) || '{}');
          transcripts.push({
            sessionId: data.sessionId,
            timestamp: data.timestamp,
            text: data.text?.substring(0, 100) + '...', // Preview
          });
        } catch (error) {
          console.error('[PostTranscription] Error parsing transcript:', key, error);
        }
      }
    }
    
    return transcripts.sort((a, b) => b.timestamp - a.timestamp);
  }
}

export interface TranscriptionOptions {
  language?: string;
  prompt?: string;
  temperature?: number;
}

export default PostTranscriptionService;
