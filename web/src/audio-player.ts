/**
 * AudioPlayer
 * 
 * Manages gapless playback of incoming 16 kHz 16-bit PCM chunks using the Web Audio API.
 * 
 * Key Responsibilities:
 * 1. Converts base64 PCM16 chunks into AudioBuffers.
 * 2. Schedules AudioBufferSourceNodes back-to-back at `nextStartTime` to prevent audio gaps or pops.
 * 3. Tracks active sources so they can be immediately aborted on interruption (clear/flush).
 * 4. Filters out stale audio using `turnId`.
 * 5. Supports smooth gain ramping for audio ducking and resuming.
 */

export class AudioPlayer {
  private audioContext: AudioContext;
  private gainNode: GainNode;
  private nextStartTime: number = 0;
  private currentTurnId: number = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();

  /** Optional callback fired when all scheduled audio finishes playing */
  public onIdle?: () => void;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;

    // Master gain node for the player (used for volume and ducking/resuming)
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);

    // Connect player output to the audio destination (speakers)
    this.gainNode.connect(this.audioContext.destination);
  }

  /**
   * Receives a base64-encoded 16 kHz 16-bit PCM chunk and schedules it for gapless playback.
   * 
   * @param payload - Base64 string containing raw 16-bit linear PCM audio
   * @param turnId - Monotonic turn identifier for this audio turn
   */
  public enqueue(payload: string, turnId: number): void {
    // Drop media if it belongs to an older, cleared turn (prevents stale audio from playing)
    if (turnId < this.currentTurnId) {
      return;
    }

    // 1. Decode base64 to binary bytes
    const binaryString = atob(payload);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 2. Wrap bytes as 16-bit signed integers (PCM16)
    const int16Array = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const sampleCount = int16Array.length;

    // 3. Convert Int16 samples into a Web Audio Float32 AudioBuffer (16,000 Hz, 1 channel)
    const audioBuffer = this.audioContext.createBuffer(1, sampleCount, 16000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      // Normalize integer [-32768, 32767] to float [-1.0, 1.0]
      channelData[i] = int16Array[i] / 32768.0;
    }

    // 4. Create source node for this chunk and connect to gain
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);

    // 5. Schedule gapless playback:
    // If the queue was empty or fell behind currentTime, schedule starting right now
    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextStartTime);

    source.start(startTime);
    this.nextStartTime = startTime + audioBuffer.duration;

    // 6. Track active source so we can stop it on clear/interruption
    this.activeSources.add(source);

    source.onended = () => {
      this.activeSources.delete(source);
      // If no more sources are scheduled or playing, trigger onIdle callback
      if (this.activeSources.size === 0 && this.audioContext.currentTime >= this.nextStartTime) {
        this.onIdle?.();
      }
    };
  }

  /**
   * Instantly stops all playing and scheduled sources, resets schedule clock,
   * and drops any future media with a turnId lower than nextTurnId.
   */
  public clear(nextTurnId: number): void {
    this.currentTurnId = nextTurnId;

    // Abort every scheduled and playing buffer source node immediately
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Source might have ended concurrently, safe to ignore
      }
    }
    this.activeSources.clear();

    // Reset schedule clock to current audio time
    this.nextStartTime = this.audioContext.currentTime;

    // Notify listeners that playback is idle
    this.onIdle?.();
  }

  /**
   * Smoothly ducks audio volume down to 15% over 40 ms (used when user begins speaking).
   */
  public duck(): void {
    const now = this.audioContext.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(0.15, now + 0.04);
  }

  /**
   * Smoothly restores audio volume back to 100% over 120 ms.
   */
  public resume(): void {
    const now = this.audioContext.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(1.0, now + 0.12);
  }

  /**
   * Returns true if there are sources currently active or scheduled in the queue.
   */
  public isPlaying(): boolean {
    return this.activeSources.size > 0;
  }

  /**
   * Returns the minimum accepted turnId.
   */
  public getCurrentTurnId(): number {
    return this.currentTurnId;
  }
}
