import './style.css';
import {
  ClientStartMessage,
  ClientMediaMessage,
  ClientStopMessage,
  ClientMarkMessage,
  ClientDebugMessage,
  ServerMessage,
} from './protocol';
import { AudioPlayer } from './audio-player';

// DOM Elements
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const meterFill = document.getElementById('meter-fill') as HTMLDivElement;
const meterValue = document.getElementById('meter-value') as HTMLSpanElement;

// Live Captions Elements
const sttStatus = document.getElementById('stt-status') as HTMLSpanElement;
const finalTranscripts = document.getElementById('final-transcripts') as HTMLDivElement;
const interimText = document.getElementById('interim-text') as HTMLParagraphElement;
const captionsBox = document.getElementById('captions-box') as HTMLDivElement;

// Dev Controls Elements
const testToneBtn = document.getElementById('test-tone-btn') as HTMLButtonElement;
const flushBtn = document.getElementById('flush-btn') as HTMLButtonElement;
const askClearBtn = document.getElementById('ask-clear-btn') as HTMLButtonElement;
const playerStatus = document.getElementById('player-status') as HTMLSpanElement;

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
let audioPlayer: AudioPlayer | null = null;
let pendingMarkName: string | null = null;

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
    testToneBtn.disabled = true;
    flushBtn.disabled = true;
    askClearBtn.disabled = true;
    statusDot.className = 'status-dot';
    statusText.textContent = 'Disconnected';
    playerStatus.className = 'player-status-badge';
    playerStatus.textContent = 'Player Idle';
    sttStatus.className = 'stt-status-badge';
    sttStatus.textContent = 'Waiting for call';
  } else if (state === 'connecting') {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    testToneBtn.disabled = true;
    flushBtn.disabled = true;
    askClearBtn.disabled = true;
    statusDot.className = 'status-dot connecting';
    statusText.textContent = 'Connecting...';
    sttStatus.className = 'stt-status-badge';
    sttStatus.textContent = 'Initializing STT...';
  } else if (state === 'streaming') {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    testToneBtn.disabled = false;
    flushBtn.disabled = false;
    askClearBtn.disabled = false;
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'Live Audio Streaming';
    sttStatus.className = 'stt-status-badge listening';
    sttStatus.textContent = 'Listening (Deepgram nova-3)';
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

    // 2. Query and display actual applied track settings
    const audioTrack = mediaStream.getAudioTracks()[0];
    if (audioTrack) {
      const settings = audioTrack.getSettings();
      settingSampleRate.textContent = settings.sampleRate ? `${settings.sampleRate} Hz` : 'Browser default';
      settingChannels.textContent = settings.channelCount ? `${settings.channelCount}` : '1 (mono)';
      settingEcho.textContent = settings.echoCancellation !== undefined ? `${settings.echoCancellation}` : 'true';
      settingNoise.textContent = settings.noiseSuppression !== undefined ? `${settings.noiseSuppression}` : 'true';
      settingGain.textContent = settings.autoGainControl !== undefined ? `${settings.autoGainControl}` : 'true';
    }

    // 3. Initialize Web Audio Context (shared between mic recorder and speaker player)
    audioContext = new AudioContext();

    // 4. Initialize the browser's AudioPlayer for playback
    audioPlayer = new AudioPlayer(audioContext);

    audioPlayer.onIdle = () => {
      playerStatus.className = 'player-status-badge';
      playerStatus.textContent = 'Player Idle';

      // If a mark was received from the server, acknowledge it once audio finishes
      if (pendingMarkName && socket && socket.readyState === WebSocket.OPEN) {
        console.log(`[AudioPlayer] Firing completed mark to server: "${pendingMarkName}"`);
        const markMsg: ClientMarkMessage = {
          type: 'mark',
          name: pendingMarkName,
        };
        socket.send(JSON.stringify(markMsg));
        pendingMarkName = null;
      }
    };

    // 5. Load the downsampling AudioWorklet processor
    await audioContext.audioWorklet.addModule('/pcm-processor.js');

    // 6. Connect microphone stream to the AudioWorklet and the AnalyserNode
    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;

    sourceNode.connect(workletNode);
    sourceNode.connect(analyserNode);

    // Start live volume visualization
    startLevelMeter(analyserNode);

    // 7. Connect to backend WebSocket endpoint via Vite proxy (/ws)
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

    // 8. Handle incoming messages from the server
    socket.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;

        switch (msg.type) {
          case 'transcript':
            if (msg.text) {
              if (msg.final) {
                // Finalized speech chunk: append as permanent message
                const line = document.createElement('div');
                line.className = 'transcript-line';
                line.textContent = `You: ${msg.text}`;
                finalTranscripts.appendChild(line);
                interimText.textContent = '';
              } else {
                // Interim speech chunk: update active preview
                interimText.textContent = `You: ${msg.text}...`;
              }
              // Auto-scroll to keep newest transcripts visible
              if (captionsBox) {
                captionsBox.scrollTop = captionsBox.scrollHeight;
              }
            }
            break;

          case 'media':
            // Schedule incoming audio chunk in the player
            audioPlayer?.enqueue(msg.payload, msg.turnId);
            playerStatus.className = 'player-status-badge playing';
            playerStatus.textContent = `Playing (Turn ${msg.turnId})`;
            break;

          case 'clear':
            console.log(`[WebSocket] Received clear nextTurnId=${msg.nextTurnId}`);
            audioPlayer?.clear(msg.nextTurnId);
            pendingMarkName = null;
            playerStatus.className = 'player-status-badge';
            playerStatus.textContent = `Cleared (minTurn=${msg.nextTurnId})`;
            break;

          case 'duck':
            console.log('[WebSocket] Ducking audio playback');
            audioPlayer?.duck();
            break;

          case 'resume':
            console.log('[WebSocket] Resuming audio playback');
            audioPlayer?.resume();
            break;

          case 'mark':
            console.log(`[WebSocket] Received server mark: "${msg.name}"`);
            pendingMarkName = msg.name;
            // If the player is already idle, acknowledge the mark immediately
            if (!audioPlayer?.isPlaying()) {
              audioPlayer?.onIdle?.();
            }
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('Failed to parse incoming WebSocket message:', err);
      }
    };

    // 9. Receive downsampled 20 ms PCM chunks from AudioWorklet and stream to server
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

  if (audioPlayer) {
    audioPlayer.clear(0);
    audioPlayer = null;
  }
  pendingMarkName = null;

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
  interimText.textContent = 'Live transcripts will appear here when you speak...';
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

// Dev button: Ask server to stream a 3-second test tone
testToneBtn.addEventListener('click', () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log('[Dev] Requesting 3-second test tone from server');
    const msg: ClientDebugMessage = {
      type: 'debug',
      action: 'test_tone',
    };
    socket.send(JSON.stringify(msg));
  }
});

// Dev button: Flush local player queue immediately
flushBtn.addEventListener('click', () => {
  console.log('[Dev] Manually flushing local audio player queue');
  audioPlayer?.clear(999);
  pendingMarkName = null;
  playerStatus.className = 'player-status-badge';
  playerStatus.textContent = 'Flushed (Local)';
});

// Dev button: Ask server to emit a clear instruction
askClearBtn.addEventListener('click', () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log('[Dev] Asking server to broadcast clear');
    const msg: ClientDebugMessage = {
      type: 'debug',
      action: 'request_clear',
    };
    socket.send(JSON.stringify(msg));
  }
});
