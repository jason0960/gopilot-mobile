/**
 * Pub/Sub connection manager for Mobile Copilot.
 *
 * Drop-in alternative to `ConnectionManager` that communicates with the
 * VS Code extension via Google Cloud Pub/Sub REST API instead of WebSockets.
 *
 * Implements the same public surface as `ConnectionManager`:
 *   - `onMessage`, `onStatusChange`, `onError` callbacks
 *   - `send()`, `disconnect()`, `markAuthenticated()`
 *   - `isConnected`, `status`, `currentConfig`
 *   - `connectPubSub(pairingInfo)` instead of `connectRelay(url, code)`
 *
 * Architecture:
 *   Mobile publishes to topic (direction: mobile_to_ext)
 *   Mobile pulls from mobileSubscription (direction: ext_to_mobile)
 *
 * @module gopilot-mobile/api/pubsub
 */

import type { ConnectionStatus } from './connection';

// ─── Types ──────────────────────────────────────────────

/** Pairing info received from the extension (via QR code or manual entry). */
export interface PubSubPairingInfo {
  readonly projectId: string;
  readonly topicName: string;
  readonly mobileSubscription: string;
  readonly extensionSubscription: string;
  readonly userId: string;
  readonly accessToken: string;
  readonly tokenExpiry: number;
}

/** Direction of message flow. */
type PubSubDirection = 'mobile_to_ext' | 'ext_to_mobile';

type PubSubMessageType = 'rpc' | 'auth' | 'heartbeat' | 'pairing' | 'disconnect' | 'token_refresh';

/** The Pub/Sub envelope format (matches protocol/pubsub-types). */
interface PubSubEnvelope {
  readonly id: string;
  readonly userId: string;
  readonly direction: PubSubDirection;
  readonly messageType: PubSubMessageType;
  readonly payload: string;
  readonly timestamp: number;
  readonly correlationId?: string;
}

/** Shape compatible with ConnectionConfig from connection.ts. */
export interface PubSubConnectionConfig {
  mode: 'pubsub';
  projectId: string;
  topicName: string;
  mobileSubscription: string;
  userId: string;
}

// ─── Constants ──────────────────────────────────────────

const PUBSUB_API_BASE = 'https://pubsub.googleapis.com/v1';
const POLL_INTERVAL_MS = 2_000;
const MAX_MESSAGES_PER_PULL = 10;
const HEARTBEAT_INTERVAL_MS = 25_000;
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECT_ATTEMPTS = 10;

// ─── Helpers ────────────────────────────────────────────

function generateId(): string {
  // Use crypto.randomUUID() where available (RN Hermes supports it),
  // fallback to manual UUID-like generation.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ─── PubSubConnection ───────────────────────────────────

export class PubSubConnection {
  private _status: ConnectionStatus = 'disconnected';
  private _config: PubSubConnectionConfig | null = null;
  private _pairing: PubSubPairingInfo | null = null;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  /** Set of processed message IDs for deduplication. */
  private seenIds = new Set<string>();
  private static readonly MAX_SEEN_IDS = 1000;

  /** Flag to prevent concurrent poll requests. */
  private polling = false;

  // ── Public callbacks (same shape as ConnectionManager) ──

  public onMessage: (data: string) => void = () => {};
  public onStatusChange: (status: ConnectionStatus) => void = () => {};
  public onError: (error: string) => void = () => {};

  // ── Public getters (same as ConnectionManager) ──

  get status(): ConnectionStatus {
    return this._status;
  }

  get isConnected(): boolean {
    return this._status === 'connected' || this._status === 'authenticated';
  }

  get currentConfig(): PubSubConnectionConfig | null {
    return this._config;
  }

  // ── Connect / Disconnect ──────────────────────────────

  /**
   * Connect using Pub/Sub pairing info (from QR code / manual entry).
   * This replaces `connectRelay(url, code)`.
   */
  connectPubSub(pairing: PubSubPairingInfo): void {
    this.clearTimers();
    this.seenIds.clear();
    this.reconnectAttempts = 0;

    this._pairing = pairing;
    this._config = {
      mode: 'pubsub',
      projectId: pairing.projectId,
      topicName: pairing.topicName,
      mobileSubscription: pairing.mobileSubscription,
      userId: pairing.userId,
    };

    this.setStatus('connecting');
    this.startPolling();
    this.startHeartbeat();

    // Transition to connected after first successful poll (or immediately)
    // We send a pairing ack so the extension knows we're alive
    this.publish('pairing', JSON.stringify({ type: 'pairing.ack', userId: pairing.userId }))
      .then(() => {
        // Guard: don't transition if we disconnected during the publish
        if (this._pairing !== pairing) return;
        this.setStatus('connected');
        this.reconnectAttempts = 0;
      })
      .catch((err) => {
        if (this._pairing !== pairing) return; // disconnected during publish
        console.error('[PubSub] Initial publish failed:', err.message);
        this.onError(`Pub/Sub connection failed: ${err.message}`);
        this.scheduleReconnect();
      });
  }

  /**
   * Disconnect and stop auto-reconnect.
   */
  disconnect(): void {
    // Send graceful disconnect notification (fire-and-forget)
    if (this._pairing && this.isConnected) {
      this.publish('disconnect', JSON.stringify({ type: 'disconnect' })).catch(() => {});
    }

    this.clearTimers();
    this._config = null;
    this._pairing = null;
    this.seenIds.clear();
    this.setStatus('disconnected');
  }

  /**
   * Send a raw string message (RPC payload).
   * Compatible with ConnectionManager.send().
   */
  send(data: string): void {
    if (!this.isConnected || !this._pairing) return;

    this.publish('rpc', data).catch((err) => {
      console.error('[PubSub] Send failed:', err.message);
      this.onError(`Send failed: ${err.message}`);
    });
  }

  /** Mark as authenticated (called by RPC layer after auth handshake). */
  markAuthenticated(): void {
    this.setStatus('authenticated');
  }

  // ── Publishing ────────────────────────────────────────

  /**
   * Publish a message to the Pub/Sub topic.
   */
  private async publish(messageType: PubSubMessageType, payload: string): Promise<void> {
    if (!this._pairing) throw new Error('Not connected');

    const envelope: PubSubEnvelope = {
      id: generateId(),
      userId: this._pairing.userId,
      direction: 'mobile_to_ext',
      messageType,
      payload,
      timestamp: Date.now(),
    };

    const topicPath = `projects/${this._pairing.projectId}/topics/${this._pairing.topicName}`;
    const url = `${PUBSUB_API_BASE}/${topicPath}:publish`;

    const body = {
      messages: [
        {
          data: btoa(JSON.stringify(envelope)),
          attributes: {
            direction: envelope.direction,
            messageType: envelope.messageType,
            userId: envelope.userId,
          },
        },
      ],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._pairing.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new Error(`Pub/Sub publish failed (${response.status}): ${text}`);
    }
  }

  // ── Polling ───────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer) return;
    // Execute first poll immediately
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    if (this.polling || !this._pairing) return;
    this.polling = true;

    try {
      const subPath = `projects/${this._pairing.projectId}/subscriptions/${this._pairing.mobileSubscription}`;
      const url = `${PUBSUB_API_BASE}/${subPath}:pull`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._pairing.accessToken}`,
        },
        body: JSON.stringify({ maxMessages: MAX_MESSAGES_PER_PULL }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.onError('Pub/Sub authentication expired. Reconnect with new pairing code.');
          this.disconnect();
          return;
        }
        throw new Error(`Pull failed (${response.status})`);
      }

      const data = await response.json();
      const receivedMessages = data.receivedMessages || [];

      if (receivedMessages.length === 0) {
        return;
      }

      // Acknowledge all messages
      const ackIds = receivedMessages.map((m: any) => m.ackId);
      this.acknowledge(ackIds).catch((err) => {
        console.error('[PubSub] Ack failed:', err.message);
      });

      // Process messages
      for (const received of receivedMessages) {
        this.processMessage(received);
      }
    } catch (err: any) {
      console.error('[PubSub] Poll error:', err.message);
      // Don't disconnect on transient errors — just log and continue
    } finally {
      this.polling = false;
    }
  }

  private processMessage(received: any): void {
    try {
      const rawData = received.message?.data;
      if (!rawData) return;

      const decoded = atob(rawData);
      const envelope: PubSubEnvelope = JSON.parse(decoded);

      // Deduplication
      if (this.seenIds.has(envelope.id)) return;
      this.seenIds.add(envelope.id);

      // Cap dedup set
      if (this.seenIds.size > PubSubConnection.MAX_SEEN_IDS) {
        const iterator = this.seenIds.values();
        for (let i = 0; i < 200; i++) {
          const next = iterator.next();
          if (next.done) break;
          this.seenIds.delete(next.value);
        }
      }

      // Filter: only process ext_to_mobile messages
      if (envelope.direction !== 'ext_to_mobile') return;

      // Filter: only process messages for our userId
      if (envelope.userId !== this._pairing?.userId) return;

      // Route by messageType
      switch (envelope.messageType) {
        case 'rpc':
        case 'auth':
          this.onMessage(envelope.payload);
          break;

        case 'heartbeat':
          // Extension heartbeat — reset reconnect counter
          this.reconnectAttempts = 0;
          break;

        case 'token_refresh':
          // Extension pushed a fresh access token — update our stored pairing
          try {
            const refreshData = JSON.parse(envelope.payload);
            if (this._pairing && refreshData.accessToken) {
              this._pairing = {
                ...this._pairing,
                accessToken: refreshData.accessToken,
                tokenExpiry: refreshData.tokenExpiry ?? this._pairing.tokenExpiry,
              };
              console.log('[PubSub] Access token refreshed by extension');
            }
          } catch (err: any) {
            console.error('[PubSub] Failed to parse token_refresh:', err.message);
          }
          break;

        case 'disconnect':
          // Extension disconnected
          this.onError('Extension disconnected.');
          this.disconnect();
          break;

        case 'pairing':
          // Pairing response from extension
          this.onMessage(envelope.payload);
          break;
      }
    } catch (err: any) {
      console.error('[PubSub] Message processing error:', err.message);
    }
  }

  private async acknowledge(ackIds: string[]): Promise<void> {
    if (!this._pairing || ackIds.length === 0) return;

    const subPath = `projects/${this._pairing.projectId}/subscriptions/${this._pairing.mobileSubscription}`;
    const url = `${PUBSUB_API_BASE}/${subPath}:acknowledge`;

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._pairing.accessToken}`,
      },
      body: JSON.stringify({ ackIds }),
    });
  }

  // ── Heartbeat & Reconnect ─────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this._pairing) {
        this.publish('heartbeat', JSON.stringify({ type: 'ping' })).catch(() => {
          // Heartbeat failure is not fatal — poll errors will trigger reconnect
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private scheduleReconnect(): void {
    this.clearTimers();

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.onError('Max reconnect attempts reached. Please reconnect manually.');
      this.setStatus('disconnected');
      return;
    }

    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * Math.min(this.reconnectAttempts, 5);
    this.setStatus('connecting');

    this.reconnectTimer = setTimeout(() => {
      if (this._pairing) {
        const currentPairing = this._pairing;
        this.startPolling();
        this.startHeartbeat();

        // Re-send pairing ack
        this.publish('pairing', JSON.stringify({ type: 'pairing.ack', userId: this._pairing.userId }))
          .then(() => {
            if (this._pairing !== currentPairing) return;
            this.setStatus('connected');
            this.reconnectAttempts = 0;
          })
          .catch(() => {
            if (this._pairing !== currentPairing) return;
            this.scheduleReconnect();
          });
      }
    }, delay);
  }

  // ── Internal ──────────────────────────────────────────

  private setStatus(status: ConnectionStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.onStatusChange(status);
    }
  }

  private clearTimers(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.polling = false;
  }
}
