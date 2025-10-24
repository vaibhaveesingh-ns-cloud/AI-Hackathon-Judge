const clampSample = (value) => {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
};

class PCMEncoderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channelData = input[0];
    if (!channelData || channelData.length === 0) {
      return true;
    }

    const pcmBuffer = new ArrayBuffer(channelData.length * Int16Array.BYTES_PER_ELEMENT);
    const pcmView = new Int16Array(pcmBuffer);

    for (let index = 0; index < channelData.length; index += 1) {
      pcmView[index] = clampSample(channelData[index]);
    }

    this.port.postMessage({ pcm: pcmBuffer }, [pcmBuffer]);
    return true;
  }
}

registerProcessor('pcm-encoder-processor', PCMEncoderProcessor);
