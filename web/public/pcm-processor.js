/**
 * PCM AudioWorklet Processor
 * 
 * Runs on the dedicated Web Audio rendering thread.
 * 
 * Responsibilities:
 * 1. Takes the browser's raw microphone audio (typically 48 kHz or 44.1 kHz Float32).
 * 2. Downsamples it to 16 kHz using linear interpolation.
 * 3. Converts Float32 (-1.0 to 1.0) to 16-bit signed integer PCM (-32768 to 32767).
 * 4. Buffers samples into exact 20 ms chunks (320 samples at 16 kHz).
 * 5. Sends each chunk to the main thread via postMessage.
 */

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.targetSampleRate = 16000;
    // 20 ms at 16,000 samples/sec = 16000 * 0.02 = 320 samples
    this.chunkSize = 320;

    // Buffer to hold 320 Int16 samples
    this.outputBuffer = new Int16Array(this.chunkSize);
    this.outputIndex = 0;

    // Downsampling ratio: input sample rate / target sample rate
    // e.g. 48,000 / 16,000 = 3.0 (meaning every 3 input samples produce 1 output sample)
    this.ratio = sampleRate / this.targetSampleRate;

    // Floating-point cursor in the input stream
    this.sourcePosition = 0;

    // Small FIFO buffer of incoming float samples for interpolation across process() boundaries
    this.inputBuffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true; // Keep processor alive even if no audio is present yet
    }

    const channelData = input[0];

    // Push new samples into the FIFO buffer
    for (let i = 0; i < channelData.length; i++) {
      this.inputBuffer.push(channelData[i]);
    }

    // Resample as many 16 kHz samples as possible
    while (this.sourcePosition + 1 < this.inputBuffer.length) {
      const idx = Math.floor(this.sourcePosition);
      const frac = this.sourcePosition - idx;

      // Linear interpolation between sample at idx and idx + 1
      const s0 = this.inputBuffer[idx];
      const s1 = this.inputBuffer[idx + 1];
      const interpolated = s0 + (s1 - s0) * frac;

      // Clamp Float32 to [-1.0, 1.0] to prevent audio clipping distortion
      const clamped = Math.max(-1.0, Math.min(1.0, interpolated));

      // Convert float sample to 16-bit signed integer (-32768 to 32767)
      const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      this.outputBuffer[this.outputIndex++] = Math.round(int16);

      // When the 20 ms chunk is complete, emit it to the main thread
      if (this.outputIndex >= this.chunkSize) {
        this.port.postMessage(this.outputBuffer.slice());
        this.outputIndex = 0;
      }

      // Step forward by the downsampling ratio
      this.sourcePosition += this.ratio;
    }

    // Remove consumed samples from the FIFO buffer to prevent memory leakage
    const consumed = Math.floor(this.sourcePosition);
    if (consumed > 0) {
      this.inputBuffer.splice(0, consumed);
      this.sourcePosition -= consumed;
    }

    return true; // Return true to keep processor alive
  }
}

registerProcessor('pcm-processor', PcmProcessor);
