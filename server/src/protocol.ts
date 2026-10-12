/**
 * BROWSER <-> SERVER JSON PROTOCOL
 * 
 * Defines all message contracts exchanged over the WebSocket connection between
 * the browser client and the backend server.
 * 
 * Messages are defined as discriminated unions on the 'type' field.
 */

// ==========================================
// Client to Server Messages
// ==========================================

export type ClientStartMessage = {
  type: 'start';
  name?: string;
  inquiry?: string;
  mode?: string;
};

export type ClientMediaMessage = {
  type: 'media';
  /** Base64-encoded 16 kHz mono 16-bit little-endian PCM audio chunk */
  payload: string;
};

export type ClientMarkMessage = {
  type: 'mark';
  /** Correlation identifier to track playback progress */
  name: string;
};

export type ClientVadMessage = {
  type: 'vad';
  /** Voice Activity Detection trigger indicating speech boundaries */
  state: 'start' | 'end';
};

export type ClientPttMessage = {
  type: 'ptt';
  /** Push-to-talk button state */
  state: 'start' | 'end';
};

export type ClientStopMessage = {
  type: 'stop';
};

/**
 * All messages that the browser client can send to the server.
 */
export type ClientMessage =
  | ClientStartMessage
  | ClientMediaMessage
  | ClientMarkMessage
  | ClientVadMessage
  | ClientPttMessage
  | ClientStopMessage;


// ==========================================
// Server to Client Messages
// ==========================================

export type ServerMediaMessage = {
  type: 'media';
  /** Base64-encoded 16 kHz mono 16-bit little-endian PCM audio chunk */
  payload: string;
  /** Monotonically increasing agent turn identifier */
  turnId: number;
};

export type ServerMarkMessage = {
  type: 'mark';
  /** Correlation identifier sent to client to synchronize audio markers */
  name: string;
};

export type ServerClearMessage = {
  type: 'clear';
  /**
   * Instructs client to immediately flush its audio buffer and drop any
   * pending or arriving media chunks with turnId < nextTurnId.
   */
  nextTurnId: number;
};

export type ServerDuckMessage = {
  type: 'duck';
};

export type ServerResumeMessage = {
  type: 'resume';
};

export type ServerTranscriptMessage = {
  type: 'transcript';
  role: 'user' | 'agent';
  text: string;
  final: boolean;
};

export type ServerDebugMessage = {
  type: 'debug';
  event: string;
  detail?: unknown;
  /** Unix timestamp in milliseconds */
  ts: number;
};

/**
 * All messages that the server can send to the browser client.
 */
export type ServerMessage =
  | ServerMediaMessage
  | ServerMarkMessage
  | ServerClearMessage
  | ServerDuckMessage
  | ServerResumeMessage
  | ServerTranscriptMessage
  | ServerDebugMessage;
