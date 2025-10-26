import { resolveBackendUrl } from './openaiService';
import workletModuleUrl from './pcmWorkletProcessor.js?url';

type TranscriptionCallback = (text: string, options?: { isFinal?: boolean }) => void;

type LifecycleCallback = () => void;

type ErrorCallback = (error: Error) => void;

interface RealtimeCallbacks {
  onTranscription?: TranscriptionCallback;
  onConnected?: LifecycleCallback;
  onDisconnected?: LifecycleCallback;
  onError?: ErrorCallback;
}

const PCM_BLOCK_SIZE = 4096;
const COMMIT_INTERVAL_MS = 600;
const MIN_COMMIT_SAMPLES = 3200; // 200ms of 16kHz mono audio

const clampSample = (value: number): number => {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
};

const toWebSocketUrl = (path: string): string => {
  const target = resolveBackendUrl(path);
  if (target.startsWith('http://') || target.startsWith('https://')) {
    const url = new URL(target);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const url = new URL(path.startsWith('/') ? path : `/${path}`, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
};

export class RealtimeTranscriptionClient {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private callbacks: RealtimeCallbacks = {};
  private commitTimer: number | null = null;
  private appendSinceCommit = false;
  private pendingSamplesSinceCommit = 0;

  async start(stream: MediaStream, callbacks: RealtimeCallbacks = {}): Promise<void> {
    this.callbacks = callbacks;
    if (this.ws) {
      this.stop();
    }
    this.pendingSamplesSinceCommit = 0;
    this.appendSinceCommit = false;

    const tokenResponse = await fetch(resolveBackendUrl('/realtime/token'), {
      method: 'POST',
    });
    if (!tokenResponse.ok) {
      throw new Error(`Failed to obtain realtime token (${tokenResponse.status})`);
    }
    const tokenPayload = await tokenResponse.json();
    const tokenValue = typeof tokenPayload?.token === 'string' ? tokenPayload.token : tokenPayload?.token?.value;
    if (!tokenValue) {
      throw new Error('Realtime token payload missing token value');
    }

    const wsUrl = new URL(toWebSocketUrl('/realtime/ws'));
    wsUrl.searchParams.set('token', tokenValue);

    this.ws = new WebSocket(wsUrl.toString());
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.callbacks.onConnected?.();
    };

    this.ws.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        return;
      }
      this.handleServerEvent(event.data);
    };

    this.ws.onerror = () => {
      this.callbacks.onError?.(new Error('Realtime websocket error'));
    };

    this.ws.onclose = () => {
      this.callbacks.onDisconnected?.();
    };

    await this.configureAudioPipeline(stream);
  }

  stop(): void {
    if (this.commitTimer !== null) {
      window.clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    this.pendingSamplesSinceCommit = 0;
    this.appendSinceCommit = false;

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.ws.close(1000, 'client stop');
    }
    this.ws = null;
    this.callbacks = {};
    this.appendSinceCommit = false;
  }

  private async configureAudioPipeline(stream: MediaStream): Promise<void> {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioContextCtor({ sampleRate: 16000 });
    await audioContext.resume();
    const source = audioContext.createMediaStreamSource(stream);
    const gain = audioContext.createGain();
    gain.gain.value = 0;

    let workletUrl: string | URL = workletModuleUrl;
    if (import.meta.env.DEV) {
      workletUrl = new URL('./pcmWorkletProcessor.ts?url', import.meta.url);
    }
    await audioContext.audioWorklet.addModule(workletUrl);
    console.log('[realtime] worklet module loaded', workletUrl.toString());
    const workletNode = new AudioWorkletNode(audioContext, 'pcm-encoder-processor');
    workletNode.port.onmessage = (event: MessageEvent) => {
      const pcmBuffer = event?.data?.pcm;
      if (pcmBuffer instanceof ArrayBuffer) {
        console.log('[realtime] pcm block bytes', pcmBuffer.byteLength);
        this.sendPcmChunk(new Int16Array(pcmBuffer));
      }
    };

    source.connect(workletNode);
    workletNode.connect(gain);
    gain.connect(audioContext.destination);

    this.audioContext = audioContext;
    this.sourceNode = source;
    this.workletNode = workletNode;
    this.gainNode = gain;
  }

  private sendPcmChunk(pcm: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    console.log('[realtime] sending chunk', pcm.byteLength);
    this.pendingSamplesSinceCommit += pcm.length;
    const base64 = arrayBufferToBase64(pcm.buffer);
    this.ws.send(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64,
      })
    );
    this.appendSinceCommit = true;
    this.scheduleCommit();
  }

  private scheduleCommit(): void {
    if (this.commitTimer !== null) {
      return;
    }
    this.commitTimer = window.setTimeout(() => {
      this.commitTimer = null;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      if (!this.appendSinceCommit) {
        return;
      }
      if (this.pendingSamplesSinceCommit < MIN_COMMIT_SAMPLES) {
        this.scheduleCommit();
        return;
      }
      this.appendSinceCommit = false;
      this.pendingSamplesSinceCommit = 0;
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    }, COMMIT_INTERVAL_MS);
  }

  private handleServerEvent(payloadText: string): void {
    try {
      const payload = JSON.parse(payloadText);
      const type = payload?.type;
      console.log('[realtime] event', type ?? '(unknown)', payload);

      const emitPartial = (text: unknown) => {
        if (typeof text === 'string' && text.length > 0) {
          this.callbacks.onTranscription?.(text);
        }
      };

      const emitFinal = (text: unknown) => {
        if (typeof text === 'string' && text.length > 0) {
          this.callbacks.onTranscription?.(text, { isFinal: true });
        }
      };

      if (
        type === 'transcription.delta' ||
        type === 'conversation.item.input_audio_transcription.delta'
      ) {
        const deltaText =
          typeof payload?.delta?.text === 'string'
            ? payload.delta.text
            : typeof payload?.delta === 'string'
              ? payload.delta
              : typeof payload?.text === 'string'
                ? payload.text
                : undefined;
        emitPartial(deltaText);
        return;
      }
      if (
        type === 'transcription.completed' ||
        type === 'conversation.item.input_audio_transcription.completed'
      ) {
        const transcriptText =
          typeof payload?.transcription?.text === 'string'
            ? payload.transcription.text
            : typeof payload?.transcription === 'string'
              ? payload.transcription
              : typeof payload?.transcript === 'string'
                ? payload.transcript
                : typeof payload?.text === 'string'
                  ? payload.text
                  : undefined;
        emitFinal(transcriptText);
        return;
      }
      if (type === 'conversation.item.input_audio_transcription.failed') {
        const errorMessage =
          typeof payload?.error?.message === 'string'
            ? payload.error.message
            : 'Realtime transcription failed for the current audio segment';
        this.callbacks.onError?.(new Error(errorMessage));
        return;
      }
      if (type === 'response.audio_transcript.delta' || type === 'response.audio_transcript.done') {
        // Ignore model-generated audio transcript events which describe assistant output.
        return;
      }
      if (type === 'error') {
        this.callbacks.onError?.(
          new Error(
            typeof payload?.error?.message === 'string'
              ? payload.error.message
              : 'Realtime service reported an error'
          )
        );
        return;
      }
      // Ignore unrelated event types to avoid showing model refusals or tool output.
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error : new Error('Realtime payload parse error'));
    }
  }
}
