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

const PCM_BLOCK_SIZE = 8192;  // Larger block size for more stable processing
const COMMIT_INTERVAL_MS = 800;  // Slightly longer interval for better sentence grouping
const MIN_COMMIT_SAMPLES = 4800; // 300ms of 16kHz mono audio - ensure enough audio before committing

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

    // Use OpenAI Realtime API through the backend proxy
    const wsUrl = new URL(toWebSocketUrl('/realtime/ws'));
    
    // Get a token from the backend
    let token: string;
    try {
      console.log('[realtime] Fetching token from:', resolveBackendUrl('/realtime/token'));
      const response = await fetch(resolveBackendUrl('/realtime/token'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[realtime] Token fetch failed:', response.status, errorText);
        throw new Error(`Failed to get realtime token: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      console.log('[realtime] Token received:', data);
      console.log('[realtime] Token type:', typeof data.token);
      console.log('[realtime] Token value:', data.token);
      
      if (!data.token) {
        // Check if there's an error message from the backend
        if (data.error) {
          throw new Error(data.error);
        }
        throw new Error('Token not found in response');
      }
      
      // Ensure token is a string
      token = String(data.token);
      console.log('[realtime] Token extracted:', token.substring(0, 20) + '...');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to initialize realtime transcription';
      console.error('[realtime] Token fetch error:', errorMsg);
      
      // Provide user-friendly error message
      let userMsg = errorMsg;
      if (errorMsg.includes('OpenAI API key')) {
        userMsg = 'OpenAI API key is missing. Please check your backend/.env file and ensure OPENAI_API_KEY is set.';
      } else if (errorMsg.includes('Failed to get realtime token')) {
        userMsg = 'Unable to connect to backend. Please ensure the backend is running at http://localhost:8000 and your OPENAI_API_KEY is configured.';
      }
      
      this.callbacks.onError?.(new Error(userMsg));
      throw error;
    }

    console.log('[realtime] Setting token in URL:', typeof token, token.substring(0, 30) + '...');
    wsUrl.searchParams.set('token', token);
    console.log('[realtime] WebSocket URL:', wsUrl.toString().replace(/token=[^&]+/, 'token=***'));
    this.ws = new WebSocket(wsUrl.toString());
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      // Session configuration is handled by the backend when creating the token
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
      if (this.ws.readyState === WebSocket.OPEN) {
        this.sendCommand('finalize');
      }
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
    
    // Add noise suppression and echo cancellation
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    
    // Create a compressor to normalize audio levels
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -30;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    
    const gain = audioContext.createGain();
    gain.gain.value = 1.2;  // Slightly boost the gain for clearer audio

    // AudioWorklet must load JavaScript, not TypeScript
    const workletUrl = new URL(workletModuleUrl, import.meta.url);
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

    // Connect audio processing chain:
    // source -> analyser -> compressor -> worklet -> gain -> destination
    source.connect(analyser);
    analyser.connect(compressor);
    compressor.connect(workletNode);
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
    console.log('[realtime] sending audio chunk', pcm.byteLength, 'bytes,', pcm.length, 'samples');
    this.pendingSamplesSinceCommit += pcm.length;
    
    // Send audio as base64 to OpenAI Realtime API
    // Create a new ArrayBuffer from the Int16Array to ensure proper alignment
    const buffer = new ArrayBuffer(pcm.length * 2);
    const view = new Int16Array(buffer);
    view.set(pcm);
    
    const base64 = arrayBufferToBase64(buffer);
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
        console.log('[realtime] Not enough samples to commit:', this.pendingSamplesSinceCommit, 'vs required', MIN_COMMIT_SAMPLES);
        this.scheduleCommit();
        return;
      }
      console.log('[realtime] Committing audio buffer with', this.pendingSamplesSinceCommit, 'samples');
      this.appendSinceCommit = false;
      this.pendingSamplesSinceCommit = 0;
      this.sendCommand('commit');
    }, COMMIT_INTERVAL_MS);
  }

  private sendCommand(command: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    // Map command types to OpenAI Realtime API commands
    let realtimeCommand: string;
    if (command === 'reset') {
      realtimeCommand = 'input_audio_buffer.clear';
    } else if (command === 'finalize') {
      // Don't clear on finalize, just stop sending
      return;
    } else if (command === 'commit') {
      realtimeCommand = 'input_audio_buffer.commit';
    } else {
      realtimeCommand = command;
    }
    
    this.ws.send(
      JSON.stringify({
        type: realtimeCommand,
      })
    );
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

      // Handle OpenAI Realtime API events
      if (type === 'conversation.item.input_audio_transcription.delta') {
        console.log('[realtime] Transcription delta received:', payload);
        const deltaText =
          typeof payload?.delta === 'string'
            ? payload.delta
            : typeof payload?.delta?.transcript === 'string'
              ? payload.delta.transcript
              : undefined;
        console.log('[realtime] Delta text:', deltaText);
        emitPartial(deltaText);
        return;
      }
      
      if (type === 'conversation.item.input_audio_transcription.completed') {
        console.log('[realtime] Transcription completed received:', payload);
        const transcriptText =
          typeof payload?.transcript === 'string'
            ? payload.transcript
            : typeof payload?.text === 'string'
              ? payload.text
              : undefined;
        console.log('[realtime] Final text:', transcriptText);
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
      
      // Legacy event types for backward compatibility
      if (type === 'transcription.delta') {
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
      
      if (type === 'transcription.completed') {
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
      
      if (type === 'transcription.failed') {
        const errorMessage =
          typeof payload?.error?.message === 'string'
            ? payload.error.message
            : 'Realtime transcription failed for the current audio segment';
        this.callbacks.onError?.(new Error(errorMessage));
        return;
      }
      
      if (type === 'ack' || type === 'session.created' || type === 'session.updated') {
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
      
      // Ignore unrelated event types
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error : new Error('Realtime payload parse error'));
    }
  }
}
