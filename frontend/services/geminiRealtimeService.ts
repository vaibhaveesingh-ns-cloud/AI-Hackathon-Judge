import { GoogleGenerativeAI } from '@google/generative-ai';

// Audio processing helpers
function floatTo16BitPCM(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const val = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = val < 0 ? val * 0x8000 : val * 0x7fff;
  }
  return int16Array;
}

function base64Encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export interface GeminiTranscriptionCallbacks {
  onTranscription?: (text: string) => void;
  onPartial?: (text: string) => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

// Store the Gemini AI instance globally to prevent re-creation
let globalGenAI: GoogleGenerativeAI | null = null;
let globalLiveClient: any = null;

export class GeminiRealtimeTranscriptionService {
  private session: any = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private callbacks: GeminiTranscriptionCallbacks = {};
  private isConnected: boolean = false;
  private accumulatedTranscript: string = '';
  private apiKey: string = '';
  private audioBuffer: Int16Array[] = [];
  private sendInterval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || import.meta.env.VITE_GEMINI_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[GeminiRealtime] No API key provided');
    }
  }

  // Create a WAV file from PCM data
  private createWAVFile(pcmData: Int16Array): ArrayBuffer {
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcmData.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Write PCM data
    const offset = 44;
    for (let i = 0; i < pcmData.length; i++) {
      view.setInt16(offset + i * 2, pcmData[i], true);
    }
    
    return buffer;
  }

  async start(options: {
    stream: MediaStream;
    callbacks?: GeminiTranscriptionCallbacks;
  }): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.callbacks = options.callbacks || {};
    this.mediaStream = options.stream;
    this.accumulatedTranscript = '';
    this.isProcessing = false;

    try {
      // Initialize Gemini AI if not already done
      if (!globalGenAI) {
        globalGenAI = new GoogleGenerativeAI(this.apiKey);
      }

      // Setup audio processing
      await this.setupAudioProcessing();
      
      // Connect to Gemini Live API
      await this.connectToGemini();
      
      this.isConnected = true;
      this.callbacks.onConnected?.();
      console.log('[GeminiRealtime] Connected and streaming audio');
    } catch (error) {
      console.error('[GeminiRealtime] Failed to start:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error('Failed to start Gemini transcription'));
      throw error;
    }
  }

  private async setupAudioProcessing(): Promise<void> {
    if (!this.mediaStream) {
      throw new Error('No media stream available');
    }

    // Create audio context with 16kHz sample rate for Gemini
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
      sampleRate: 16000 
    });

    // Resume audio context if suspended
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Create source from media stream
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    
    // Create script processor for capturing audio chunks (4096 samples buffer)
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    
    // Keep reference to prevent garbage collection
    (window as any).__geminiAudioProcessor = this.processorNode;
    (window as any).__geminiSourceNode = this.sourceNode;
    
    // Process audio chunks
    this.processorNode.onaudioprocess = (audioProcessingEvent) => {
      if (!this.isConnected || !this.session || this.isProcessing) return;
      
      const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
      const pcmData = floatTo16BitPCM(inputData);
      
      // Buffer the audio
      this.audioBuffer.push(pcmData);
      
      // Send buffered audio periodically (less frequently for better transcription)
      if (!this.sendInterval) {
        this.sendInterval = setInterval(() => {
          this.sendBufferedAudio();
        }, 3000); // Send every 3 seconds for better context
      }
    };
    
    // Connect audio pipeline
    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
  }

  private async connectToGemini(): Promise<void> {
    if (!globalGenAI) {
      throw new Error('Gemini AI not initialized');
    }

    try {
      // Check if the live API is available
      if ('live' in globalGenAI) {
        console.log('[GeminiRealtime] Using Gemini Live API');
        
        globalLiveClient = (globalGenAI as any).live;
        
        // Connect to the live session with audio configuration
        this.session = await globalLiveClient.connect({
          model: 'models/gemini-2.0-flash-exp', // Latest model with audio support
          config: {
            response_modalities: ['AUDIO', 'TEXT'], // Enable both audio and text responses
            system_instruction: `You are a real-time transcription assistant. 
              Your role is to accurately transcribe spoken audio into text. 
              Focus on capturing every word clearly and maintaining proper punctuation. 
              Do not add commentary or interpretation, only transcribe what is spoken.
              Respond with the transcribed text only.`,
            generation_config: {
              temperature: 0.1, // Low temperature for accurate transcription
              candidateCount: 1,
            }
          }
        });

        // Set up message handling
        if (this.session) {
          // Listen for responses
          this.setupResponseHandling();
        }
      } else {
        // Fallback to standard model if live API is not available
        console.log('[GeminiRealtime] Live API not available, using standard model');
        
        const model = globalGenAI.getGenerativeModel({
          model: 'gemini-2.0-flash-exp',
          generationConfig: {
            temperature: 0.1,
          },
        });
        
        // Start a chat session
        this.session = model.startChat({
          history: [],
        });
      }
    } catch (error) {
      console.error('[GeminiRealtime] Failed to connect:', error);
      throw error;
    }
  }

  private setupResponseHandling(): void {
    if (!this.session) return;

    // Handle incoming messages
    const handleResponse = async () => {
      try {
        // For live API, we need to handle streaming responses
        if (this.session.on) {
          this.session.on('message', (message: any) => {
            this.handleGeminiMessage(message);
          });
        }
      } catch (error) {
        console.error('[GeminiRealtime] Error handling response:', error);
      }
    };

    handleResponse();
  }

  private handleGeminiMessage(message: any): void {
    try {
      let text = '';
      
      // Try different ways to extract text from the response
      if (typeof message?.text === 'function') {
        text = message.text();
      } else if (typeof message?.text === 'string') {
        text = message.text;
      } else if (message?.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = message.candidates[0].content.parts[0].text;
      } else if (message?.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = message.response.candidates[0].content.parts[0].text;
      }
      
      // Clean and process the text
      text = text.trim();
      
      if (text && text.length > 0) {
        // Filter out any non-transcription content (like "Transcribe the following...")
        if (!text.toLowerCase().includes('transcribe') && !text.toLowerCase().includes('audio')) {
          this.accumulatedTranscript += (this.accumulatedTranscript ? ' ' : '') + text;
          this.callbacks.onTranscription?.(text);
          this.callbacks.onPartial?.(this.accumulatedTranscript);
          console.log('[GeminiRealtime] Transcribed:', text);
        }
      }
    } catch (error) {
      console.error('[GeminiRealtime] Error processing message:', error);
    }
  }

  private async sendBufferedAudio(): Promise<void> {
    if (!this.session || !this.isConnected || this.audioBuffer.length === 0 || this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Combine audio chunks
      const totalLength = this.audioBuffer.reduce((acc, chunk) => acc + chunk.length, 0);
      const combinedAudio = new Int16Array(totalLength);
      let offset = 0;
      
      for (const chunk of this.audioBuffer) {
        combinedAudio.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Clear buffer
      this.audioBuffer = [];
      
      // Convert to WAV format with proper headers
      const wavBuffer = this.createWAVFile(combinedAudio);
      const audioData = base64Encode(wavBuffer);
      
      // Send to Gemini
      if (this.session.send) {
        // For live API
        await this.session.send({
          audio: {
            data: audioData,
            mimeType: 'audio/wav'
          }
        });
      } else if (this.session.sendMessage) {
        // For chat API - send with transcription instruction
        const prompt = "Transcribe the following audio. Return only the spoken words, no additional text or formatting.";
        
        const response = await this.session.sendMessage([
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: audioData
            }
          },
          prompt
        ]);
        
        // Handle the response
        if (response?.response) {
          this.handleGeminiMessage(response.response);
        }
      }
    } catch (error) {
      console.error('[GeminiRealtime] Error sending audio:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  stop(): void {
    // Clear send interval
    if (this.sendInterval) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }

    // Send any remaining buffered audio
    if (this.audioBuffer.length > 0) {
      this.sendBufferedAudio().catch(console.error);
    }

    // Disconnect audio nodes
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    // Close audio context
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(console.error);
      this.audioContext = null;
    }

    // Close session
    if (this.session) {
      if (this.session.close) {
        this.session.close();
      }
      this.session = null;
    }

    // Clean up global references
    if ((window as any).__geminiAudioProcessor) {
      delete (window as any).__geminiAudioProcessor;
    }
    if ((window as any).__geminiSourceNode) {
      delete (window as any).__geminiSourceNode;
    }

    this.isConnected = false;
    this.callbacks.onDisconnected?.();
    
    console.log('[GeminiRealtime] Stopped');
  }
}
