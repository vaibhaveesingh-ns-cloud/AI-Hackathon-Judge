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
  private onPartial?: PartialCallback;
  private onFinal?: FinalCallback;
  private onError?: ErrorCallback;

  async start({ stream, onPartial, onFinal, onError }: StartOptions): Promise<void> {
    this.stop();
    this.partialBuffer = '';
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
              this.onFinal?.(trimmed);
            } else {
              this.flush();
            }
            this.partialBuffer = '';
            return;
          }

          this.partialBuffer += text;
          const cleaned = this.partialBuffer.trim();
          if (cleaned.length > 0) {
            this.onPartial?.(cleaned);
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
    if (this.client) {
      this.client.stop();
      this.client = null;
    }
    activeControllers.delete(this);
    this.partialBuffer = '';
    this.onPartial = undefined;
    this.onFinal = undefined;
    this.onError = undefined;
  }

  flush(): void {
    const cleaned = this.partialBuffer.trim();
    if (cleaned.length > 0) {
      this.onFinal?.(cleaned);
      this.partialBuffer = '';
    }
  }
}

export const flushPendingTranscriptions = async (): Promise<void> => {
  activeControllers.forEach((controller) => controller.flush());
};