export class AudioRecordingService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recordingStartTime: number = 0;
  private recordingEndTime: number = 0;

  async startRecording(stream: MediaStream): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      console.warn('[AudioRecording] Already recording');
      return;
    }

    // Reset for new recording
    this.audioChunks = [];
    this.recordingStartTime = Date.now();

    // Create MediaRecorder with optimal settings for transcription
    const options: MediaRecorderOptions = {
      mimeType: this.getSupportedMimeType(),
      audioBitsPerSecond: 128000, // High quality for better transcription
    };

    this.mediaRecorder = new MediaRecorder(stream, options);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
        console.log('[AudioRecording] Chunk recorded:', event.data.size, 'bytes');
      }
    };

    this.mediaRecorder.onerror = (error) => {
      console.error('[AudioRecording] Recording error:', error);
    };

    this.mediaRecorder.onstop = () => {
      this.recordingEndTime = Date.now();
      const duration = (this.recordingEndTime - this.recordingStartTime) / 1000;
      console.log('[AudioRecording] Recording stopped. Duration:', duration, 'seconds');
    };

    // Start recording with 1-second chunks for stability
    this.mediaRecorder.start(1000);
    console.log('[AudioRecording] Recording started');
  }

  stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        reject(new Error('No active recording'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        this.recordingEndTime = Date.now();
        const duration = (this.recordingEndTime - this.recordingStartTime) / 1000;
        console.log('[AudioRecording] Creating audio blob. Duration:', duration, 'seconds');

        // Combine all chunks into a single blob
        const audioBlob = new Blob(this.audioChunks, { 
          type: this.mediaRecorder?.mimeType || 'audio/webm' 
        });
        
        console.log('[AudioRecording] Audio blob created:', audioBlob.size, 'bytes');
        resolve(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  pauseRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      console.log('[AudioRecording] Recording paused');
    }
  }

  resumeRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      console.log('[AudioRecording] Recording resumed');
    }
  }

  getRecordingDuration(): number {
    if (this.recordingStartTime === 0) return 0;
    const endTime = this.recordingEndTime || Date.now();
    return (endTime - this.recordingStartTime) / 1000;
  }

  getRecordingState(): RecordingState | null {
    if (!this.mediaRecorder) return null;
    return this.mediaRecorder.state as RecordingState;
  }

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log('[AudioRecording] Using mime type:', type);
        return type;
      }
    }

    console.warn('[AudioRecording] No preferred mime type supported, using default');
    return '';
  }

  // Convert blob to base64 for storage/transmission
  async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Create a download link for the recorded audio
  createDownloadLink(blob: Blob, filename: string = 'presentation-audio.webm'): string {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return url;
  }
}

export type RecordingState = 'recording' | 'paused' | 'inactive';

export default AudioRecordingService;
