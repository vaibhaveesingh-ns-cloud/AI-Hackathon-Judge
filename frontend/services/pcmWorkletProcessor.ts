
interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new(): AudioWorkletProcessor;
};

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;

const clampSample = (value: number): number => {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
};

const FRAME_SIZE = 1600; // 100 ms at 16 kHz

class PCMEncoderProcessor extends AudioWorkletProcessor {
  private buffer: Int16Array = new Int16Array(0);

  private appendSamples(samples: Int16Array): void {
    const merged = new Int16Array(this.buffer.length + samples.length);
    merged.set(this.buffer);
    merged.set(samples, this.buffer.length);
    this.buffer = merged;
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channelData = input[0];
    if (!channelData || channelData.length === 0) {
      return true;
    }

    const pcmView = new Int16Array(channelData.length);
    for (let index = 0; index < channelData.length; index += 1) {
      pcmView[index] = clampSample(channelData[index]);
    }

    this.appendSamples(pcmView);

    while (this.buffer.length >= FRAME_SIZE) {
      const frame = this.buffer.slice(0, FRAME_SIZE);
      this.buffer = this.buffer.slice(FRAME_SIZE);
      this.port.postMessage({ pcm: frame.buffer }, [frame.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-encoder-processor', PCMEncoderProcessor);

export {};
