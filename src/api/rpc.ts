/**
 * JSON-RPC client for Mobile Copilot.
 * Matches the protocol in @mobile-copilot/protocol.
 *
 * Includes E2E encryption: X25519 key exchange + XSalsa20-Poly1305 AEAD.
 */

import { ConnectionManager } from './connection';
import { E2ECrypto } from './e2e-crypto';

export interface RpcMessage {
  id: string;
  type: 'request' | 'response' | 'stream' | 'event' | 'error';
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
}

type EventHandler = (method: string, params: any) => void;
type StreamChunkHandler = (id: string, chunk: string) => void;

interface PendingRequest {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  onChunk?: (chunk: string) => void;
  streamBuffer?: string;
}

let _idCounter = 0;
function genId(): string {
  return `rn_${Date.now()}_${++_idCounter}`;
}

export class RpcClient {
  private pending = new Map<string, PendingRequest>();
  private conn: ConnectionManager;
  private readonly e2e = new E2ECrypto();

  /** Stored session ID for reconnection auth. Set after successful auth. */
  public sessionId: string | null = null;

  public onEvent: EventHandler = () => {};
  public onStreamChunk: StreamChunkHandler = () => {};

  constructor(connection: ConnectionManager) {
    this.conn = connection;
    this.conn.onMessage = (raw: string) => this.handleMessage(raw);
  }

  /**
   * Handle relay control messages and forward RPC messages.
   * Returns true if the message was a relay control message.
   *
   * On relay.joined / host_reconnected: initiates E2E key exchange
   * (auth is sent AFTER key exchange completes, in handleMessage).
   */
  handleRelayMessage(msg: any): boolean {
    if (msg.type === 'relay.joined') {
      console.log('[Relay] Joined room:', msg.code, 'hostConnected:', msg.hostConnected);
      if (msg.hostConnected) {
        // Start E2E key exchange before auth
        this.e2e.reset();
        const pubkey = this.e2e.generateKeyPair();
        console.log('[Relay] Starting E2E key exchange...');
        this.conn.send(JSON.stringify({ type: 'e2e.keyExchange', pubkey }));
      } else {
        console.log('[Relay] Host not connected — waiting for host_reconnected event');
      }
      return true;
    }
    if (msg.type === 'event' && msg.method === 'relay.host_reconnected') {
      // Re-initiate key exchange on host reconnect
      this.e2e.reset();
      const pubkey = this.e2e.generateKeyPair();
      console.log('[Relay] Host reconnected — re-initiating E2E key exchange...');
      this.conn.send(JSON.stringify({ type: 'e2e.keyExchange', pubkey }));
      return true;
    }
    if (msg.type === 'event' && msg.method === 'relay.host_disconnected') {
      return true;
    }
    return false;
  }

  private handleMessage(raw: string): void {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error('[RPC] Invalid JSON:', raw);
      return;
    }

    // ── E2E key exchange response from host ──
    if ((msg as any).type === 'e2e.keyExchange' && (msg as any).pubkey) {
      console.log('[E2E] Received host public key — deriving shared key');
      this.e2e.deriveSharedKey((msg as any).pubkey);
      console.log('[E2E] Key exchange complete — sending encrypted auth');
      // Now send auth (will be encrypted automatically via sendRaw)
      const authParams: any = { relay: true };
      if (this.sessionId) {
        authParams.sessionId = this.sessionId;
        console.log('[E2E] Auth includes sessionId for missed message recovery');
      }
      this.sendRaw({ id: genId(), type: 'request', method: 'auth', params: authParams });
      return;
    }

    // ── E2E encrypted message — decrypt and re-process ──
    if ((msg as any).type === 'e2e.encrypted' && (msg as any).n && (msg as any).c) {
      try {
        const decrypted = this.e2e.decrypt(msg as any);
        console.log('[E2E] Decrypted message:', decrypted.substring(0, 100));
        this.handleMessage(decrypted);   // re-enter with plaintext
      } catch (err: any) {
        console.error('[E2E] Decryption failed:', err.message);
      }
      return;
    }

    // Handle relay control messages
    if (this.conn.currentConfig?.mode === 'relay') {
      if (this.handleRelayMessage(msg)) return;
    }

    // Events
    if (msg.type === 'event') {
      console.log('[RPC] Event received:', msg.method, msg.params ? JSON.stringify(msg.params).substring(0, 100) : '');
      this.onEvent(msg.method!, msg.params);
      return;
    }

    // Stream chunks
    if (msg.type === 'stream') {
      const p = this.pending.get(msg.id);
      if (p) {
        const chunk = msg.result as string;
        p.streamBuffer = (p.streamBuffer || '') + chunk;
        p.onChunk?.(chunk);
      }
      this.onStreamChunk(msg.id, msg.result);
      return;
    }

    // Response / Error
    if (msg.type === 'response' || msg.type === 'error') {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.type === 'error' || msg.error) {
          p.reject(new Error(msg.error?.message || 'Unknown error'));
        } else {
          p.resolve(msg.result);
        }
      }
      return;
    }
  }

  /**
   * Send an RPC request and wait for a response.
   */
  request<T = any>(method: string, params?: any, timeoutMs = 30000): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = genId();
      this.pending.set(id, { resolve, reject });
      this.sendRaw({ id, type: 'request', method, params });

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  /**
   * Send an RPC request that returns a stream.
   * onChunk called for each chunk; resolves with full accumulated text.
   */
  stream(method: string, params: any, onChunk: (chunk: string) => void, timeoutMs = 120000): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = genId();
      const pending: PendingRequest = {
        resolve: () => {
          this.pending.delete(id);
          resolve(pending.streamBuffer || '');
        },
        reject: (err) => {
          this.pending.delete(id);
          reject(err);
        },
        onChunk,
        streamBuffer: '',
      };
      this.pending.set(id, pending);
      this.sendRaw({ id, type: 'request', method, params });

      setTimeout(() => {
        if (this.pending.has(id)) {
          const p = this.pending.get(id)!;
          this.pending.delete(id);
          resolve(p.streamBuffer || '');
        }
      }, timeoutMs);
    });
  }

  /**
   * Send a raw message object. Encrypted automatically if E2E is established.
   */
  sendRaw(msg: any): void {
    const json = JSON.stringify(msg);
    if (this.e2e.isReady) {
      console.log('[E2E] Encrypting outgoing message');
      this.conn.send(this.e2e.encrypt(json));
    } else {
      this.conn.send(json);
    }
  }

  /**
   * Authenticate with the server.
   */
  authenticate(sessionId?: string, token?: string): void {
    if (sessionId) {
      this.sendRaw({ id: genId(), type: 'request', method: 'auth', params: { sessionId } });
    } else if (token) {
      // First try HTTP auth to get session, then WS auth
      this.sendRaw({ id: genId(), type: 'request', method: 'auth', params: { token } });
    }
  }

  /**
   * Cancel all pending requests.
   */
  cancelAll(): void {
    for (const [id, p] of this.pending) {
      p.reject(new Error('Connection closed'));
    }
    this.pending.clear();
  }
}
