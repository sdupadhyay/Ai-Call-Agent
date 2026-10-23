import WebSocket from 'ws';
import {
  ServerMediaMessage,
  ServerClearMessage,
  ServerDuckMessage,
  ServerMarkMessage,
  ServerResumeMessage,
  ServerTranscriptMessage,
} from './protocol';

/**
 * Transport
 * 
 * Abstract transport interface decoupling conversation logic (CallSession)
 * from the underlying communication channel (browser WebSocket, Twilio/telephony, etc.).
 */
export interface Transport {
  sendAudio(payload: string, turnId: number): void;
  sendMark(name: string): void;
  sendClear(nextTurnId: number): void;
  sendDuck(): void;
  sendResume(): void;
  sendTranscript(role: 'user' | 'agent', text: string, final: boolean): void;
}

/**
 * WebSocketTransport
 * 
 * Concrete Transport implementation that serializes protocol messages
 * as JSON frames over a client WebSocket.
 */
export class WebSocketTransport implements Transport {
  constructor(private socket: WebSocket) {}

  public sendAudio(payload: string, turnId: number): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      const message: ServerMediaMessage = {
        type: 'media',
        payload,
        turnId,
      };
      this.socket.send(JSON.stringify(message));
    }
  }

  public sendMark(name: string): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      const message: ServerMarkMessage = {
        type: 'mark',
        name,
      };
      this.socket.send(JSON.stringify(message));
    }
  }

  public sendClear(nextTurnId: number): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      const message: ServerClearMessage = {
        type: 'clear',
        nextTurnId,
      };
      this.socket.send(JSON.stringify(message));
    }
  }

  public sendDuck(): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      const message: ServerDuckMessage = {
        type: 'duck',
      };
      this.socket.send(JSON.stringify(message));
    }
  }

  public sendResume(): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      const message: ServerResumeMessage = {
        type: 'resume',
      };
      this.socket.send(JSON.stringify(message));
    }
  }

  public sendTranscript(role: 'user' | 'agent', text: string, final: boolean): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      const message: ServerTranscriptMessage = {
        type: 'transcript',
        role,
        text,
        final,
      };
      this.socket.send(JSON.stringify(message));
    }
  }
}
