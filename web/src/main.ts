import './style.css';
import { ClientStartMessage, ClientMediaMessage, ClientStopMessage } from './protocol';

// DOM Elements
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const meterFill = document.getElementById('meter-fill') as HTMLDivElement;
const meterValue = document.getElementById('meter-value') as HTMLSpanElement;

// Settings elements
const settingSampleRate = document.getElementById('setting-sample-rate') as HTMLSpanElement;
const settingChannels = document.getElementById('setting-channels') as HTMLSpanElement;
const settingEcho = document.getElementById('setting-echo') as HTMLSpanElement;
const settingNoise = document.getElementById('setting-noise') as HTMLSpanElement;
const settingGain = document.getElementById('setting-gain') as HTMLSpanElement;

// Runtime state
let socket: WebSocket | null = null;
let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;
let analyserNode: AnalyserNode | null = null;
let animationFrameId: number | null = null;

/**
 * Encodes an Int16Array (16-bit PCM little-endian) to a Base64 string.
 */
function int16ArrayToBase64(int16Array: Int16Array): string {
  const bytes = new Uint8Array(int16Array.buffer, int16Array.byteOffset, int16Array.byteLength);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Updates the UI status indicator and button disabled states.
 */
function setCallState(state: 'idle' | 'connecting' | 'streaming') {
  if (state === 'idle') {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusDot.className = 'status-dot';
    statusText.textContent = 'Disconnected';
  } else if (state === 'connecting') {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusDot.className = 'status-dot connecting';
    statusText.textContent = 'Connecting...';
  } else if (state === 'streaming') {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'Live Audio Streaming';
  }
}

/**
 * Runs an animation frame loop to visualize live microphone volume.
 */
function startLevelMeter(analyser: AnalyserNode) {
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function drawMeter() {
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;

    // Scale to a natural-looking percentage (0-100)
    const percentage = Math.min(100, Math.round((average / 128) * 100));
    meterFill.style.width = `${percentage}%`;
    meterValue.textContent = `${percentage}%`;

    animationFrameId = requestAnimationFrame(drawMeter);
  }

  drawMeter();
}

/**
 * Stops the level meter animation and resets the visual bar.
 */
function stopLevelMeter() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  meterFill.style.width = '0%';
  meterValue.textContent = '0%';
}

/**
 * Starts audio capture and connects to the WebSocket server.
 */
async function startCall() {
  try {
    setCallState('connecting');

    // 1. Request microphone access with specific audio processing constraints
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1, // Mono audio
      },
    });

    // 2. Query and display actual applied track settings in the UI screen
    const audioTrack = mediaStream.getAudioTracks()[0];
    if (audioTrack) {
      const settings = audioTrack.getSettings();
      settingSampleRate.textContent = settings.sampleRate ? `${settings.sampleRate} Hz` : 'Browser default';
      settingChannels.textContent = settings.channelCount ? `${settings.channelCount}` : '1 (mono)';
      settingEcho.textContent = settings.echoCancellation !== undefined ? `${settings.echoCancellation}` : 'true';
      settingNoise.textContent = settings.noiseSuppression !== undefined ? `${settings.noiseSuppression}` : 'true';
      settingGain.textContent = settings.autoGainControl !== undefined ? `${settings.autoGainControl}` : 'true';
    }

    // 3. Initialize Web Audio Context
    audioContext = new AudioContext();

    // 4. Load the downsampling AudioWorklet processor
    await audioContext.audioWorklet.addModule('/pcm-processor.js');

    // 5. Connect microphone stream to the AudioWorklet and the AnalyserNode
    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;

    sourceNode.connect(workletNode);
    sourceNode.connect(analyserNode);

    // Start live volume visualization
    startLevelMeter(analyserNode);

    // 6. Connect to backend WebSocket endpoint via Vite proxy (/ws)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      setCallState('streaming');

      // Send initial session "start" message
      const startMessage: ClientStartMessage = {
        type: 'start',
        name: 'Web User',
        inquiry: 'General Voice Session',
        mode: 'normal',
      };
      socket?.send(JSON.stringify(startMessage));
    };

    // 7. Receive downsampled 20 ms PCM chunks from AudioWorklet and stream to server
    workletNode.port.onmessage = (event: MessageEvent<Int16Array>) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        const int16Array = event.data;
        const payloadBase64 = int16ArrayToBase64(int16Array);

        const mediaMessage: ClientMediaMessage = {
          type: 'media',
          payload: payloadBase64,
        };

        socket.send(JSON.stringify(mediaMessage));
      }
    };

    socket.onclose = () => {
      stopCall();
    };

    socket.onerror = (err) => {
      console.error('WebSocket connection error:', err);
      stopCall();
    };
  } catch (err) {
    console.error('Failed to start call:', err);
    alert('Could not start call. Please ensure microphone permissions are granted.');
    stopCall();
  }
}

/**
 * Cleans up media stream, audio context, and closes the WebSocket connection.
 */
function stopCall() {
  stopLevelMeter();

  // Send "stop" message if socket is still open
  if (socket && socket.readyState === WebSocket.OPEN) {
    const stopMessage: ClientStopMessage = { type: 'stop' };
    socket.send(JSON.stringify(stopMessage));
    socket.close();
  }
  socket = null;

  // Disconnect and stop audio tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  // Close AudioContext
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch((err) => {
      console.error('Error closing AudioContext:', err);
    });
    audioContext = null;
  }

  workletNode = null;
  analyserNode = null;

  setCallState('idle');
}

// Bind button event listeners
startBtn.addEventListener('click', () => {
  startCall().catch((err) => {
    console.error('Unhandled error in startCall:', err);
  });
});

stopBtn.addEventListener('click', () => {
  stopCall();
});
