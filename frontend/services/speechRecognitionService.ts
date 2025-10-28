import { RealtimeTranscriptionClient } from './realtimeService';

type PartialCallback = (text: string) => void;
type FinalCallback = (text: string) => void;
type ErrorCallback = (error: Error) => void;

type StartOptions = {
  stream: MediaStream;
  onPartial?: PartialCallback;
  onFinal?: FinalCallback;
  onError?: ErrorCallback;
};

const activeControllers = new Set<SpeechRecognitionController>();

export class SpeechRecognitionController {
  private client: RealtimeTranscriptionClient | null = null;
  private partialBuffer = '';
  private accumulatedTranscript = '';
  private lastFinalTime = 0;
  private sentenceTimeout: NodeJS.Timeout | null = null;
  private onPartial?: PartialCallback;
  private onFinal?: FinalCallback;
  private onError?: ErrorCallback;

  async start({ stream, onPartial, onFinal, onError }: StartOptions): Promise<void> {
    this.stop();
    this.partialBuffer = '';
    this.accumulatedTranscript = '';
    this.lastFinalTime = 0;
    this.onPartial = onPartial;
    this.onFinal = onFinal;
    this.onError = onError;

    const client = new RealtimeTranscriptionClient();
    this.client = client;
    activeControllers.add(this);

    try {
      await client.start(stream, {
        onTranscription: (text, options) => {
          if (typeof text !== 'string') return;

          if (options?.isFinal) {
            const trimmed = text.trim();
            if (trimmed.length > 0) {
              // Accumulate the final chunk
              if (this.accumulatedTranscript.length > 0) {
                this.accumulatedTranscript += ' ';
              }
              this.accumulatedTranscript += trimmed;
              
              // Clear any existing timeout
              if (this.sentenceTimeout) {
                clearTimeout(this.sentenceTimeout);
              }
              
              // Check if this looks like a complete sentence or thought
              const endsWithPunctuation = /[.!?]$/.test(trimmed);
              const hasMinimumWords = this.accumulatedTranscript.split(' ').length >= 8;
              const timeSinceLastFinal = Date.now() - this.lastFinalTime;
              
              // More intelligent sentence completion detection
              if (endsWithPunctuation || 
                  (hasMinimumWords && timeSinceLastFinal > 1500) ||
                  timeSinceLastFinal > 3000) {
                // Complete sentence, enough words with pause, or long pause
                if (this.accumulatedTranscript.length > 0) {
                  this.onFinal?.(this.accumulatedTranscript);
                  this.accumulatedTranscript = '';
                }
              } else {
                // Wait for more chunks to form continuous speech
                if (this.sentenceTimeout) {
                  clearTimeout(this.sentenceTimeout);
                }
                this.sentenceTimeout = setTimeout(() => {
                  if (this.accumulatedTranscript.length > 0) {
                    this.onFinal?.(this.accumulatedTranscript);
                    this.accumulatedTranscript = '';
                  }
                }, 1000); // Shorter timeout for more continuous flow
              }
              
              this.lastFinalTime = Date.now();
            }
            this.partialBuffer = '';
            return;
          }

          this.partialBuffer += text;
          const cleaned = this.partialBuffer.trim();
          if (cleaned.length > 0) {
            // Show accumulated + partial for live preview
            const preview = this.accumulatedTranscript.length > 0 
              ? this.accumulatedTranscript + ' ' + cleaned 
              : cleaned;
            this.onPartial?.(preview);
          }
        },
        onError: (error) => {
          const normalized = error instanceof Error ? error : new Error('Realtime transcription error');
          this.onError?.(normalized);
        },
        onDisconnected: () => {
          this.flush();
        },
      });
    } catch (error) {
      this.client = null;
      activeControllers.delete(this);
      this.partialBuffer = '';
      throw error instanceof Error ? error : new Error('Failed to start speech recognition');
    }
  }

  stop(): void {
    this.flush();
    if (this.client) {
      this.client.stop();
      this.client = null;
    }
    activeControllers.delete(this);
  }

  flush(): void {
    // Clear any pending timeout
    if (this.sentenceTimeout) {
      clearTimeout(this.sentenceTimeout);
      this.sentenceTimeout = null;
    }
    
    // Flush any accumulated transcript
    if (this.accumulatedTranscript.length > 0) {
      this.onFinal?.(this.accumulatedTranscript);
      this.accumulatedTranscript = '';
    } else {
      // If no accumulated transcript, flush the partial buffer
      const cleaned = this.partialBuffer.trim();
      if (cleaned.length > 0) {
        this.onFinal?.(cleaned);
      }
    }
    this.partialBuffer = '';
  }
}

export const flushPendingTranscriptions = async (): Promise<void> => {
  activeControllers.forEach((controller) => controller.flush());
};