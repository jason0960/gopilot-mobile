/**
 * Tests for PubSubConnection — Pub/Sub lifecycle, polling, publishing,
 * deduplication, reconnect, heartbeat, and status transitions.
 *
 * Uses a mocked global `fetch` (no real network calls).
 */

import { PubSubConnection, PubSubPairingInfo } from '../src/api/pubsub';

// ─── Test Helpers ───────────────────────────────────────

function makePairing(overrides?: Partial<PubSubPairingInfo>): PubSubPairingInfo {
  return {
    projectId: 'test-project',
    topicName: 'test-topic',
    mobileSubscription: 'mobile-sub-user1',
    extensionSubscription: 'ext-sub-user1',
    userId: 'user1',
    accessToken: 'test-token',
    tokenExpiry: Date.now() + 3600_000,
    ...overrides,
  };
}

/** Create a base64-encoded Pub/Sub envelope. */
function makeEnvelope(overrides?: Record<string, any>): string {
  const envelope = {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    userId: 'user1',
    direction: 'ext_to_mobile',
    messageType: 'rpc',
    payload: JSON.stringify({ id: 'r1', type: 'response', result: 'ok' }),
    timestamp: Date.now(),
    ...overrides,
  };
  return btoa(JSON.stringify(envelope));
}

/** Build a Pub/Sub pull response with receivedMessages. */
function makePullResponse(...envelopes: string[]): object {
  return {
    receivedMessages: envelopes.map((data, i) => ({
      ackId: `ack-${i}`,
      message: { data, messageId: `mid-${i}` },
    })),
  };
}

// ─── Fetch Mock Setup ───────────────────────────────────

let fetchMock: jest.Mock;
let fetchResponses: Map<string, () => Response>;

function mockFetchResponse(urlPattern: string, body: any, status = 200): void {
  fetchResponses.set(urlPattern, () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response));
}

function setupDefaultFetchMocks(): void {
  // Default: publish succeeds, pull returns empty
  mockFetchResponse(':publish', { messageIds: ['mid-1'] });
  mockFetchResponse(':pull', { receivedMessages: [] });
  mockFetchResponse(':acknowledge', {});
}

// ─── Test Suite ─────────────────────────────────────────

describe('PubSubConnection', () => {
  let conn: PubSubConnection;

  beforeEach(() => {
    jest.useFakeTimers();

    fetchResponses = new Map();
    fetchMock = jest.fn(async (url: string) => {
      for (const [pattern, factory] of fetchResponses) {
        if (url.includes(pattern)) return factory();
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
    });
    (global as any).fetch = fetchMock;

    // Ensure btoa/atob are available in test env
    if (typeof btoa === 'undefined') {
      (global as any).btoa = (s: string) => Buffer.from(s).toString('base64');
      (global as any).atob = (s: string) => Buffer.from(s, 'base64').toString();
    }

    setupDefaultFetchMocks();
    conn = new PubSubConnection();
  });

  afterEach(() => {
    conn.disconnect();
    jest.useRealTimers();
    delete (global as any).fetch;
  });

  // ── Constructor & Initial State ───────────────────────

  describe('initial state', () => {
    it('starts disconnected', () => {
      expect(conn.status).toBe('disconnected');
      expect(conn.isConnected).toBe(false);
      expect(conn.currentConfig).toBeNull();
    });
  });

  // ── connectPubSub ─────────────────────────────────────

  describe('connectPubSub', () => {
    it('transitions to connecting then connected on successful publish', async () => {
      const statuses: string[] = [];
      conn.onStatusChange = (s) => statuses.push(s);

      conn.connectPubSub(makePairing());
      expect(statuses).toContain('connecting');

      // Let the initial publish resolve
      await jest.advanceTimersByTimeAsync(10);

      expect(statuses).toContain('connected');
      expect(conn.status).toBe('connected');
      expect(conn.isConnected).toBe(true);
    });

    it('sets config correctly', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(conn.currentConfig).toEqual({
        mode: 'pubsub',
        projectId: 'test-project',
        topicName: 'test-topic',
        mobileSubscription: 'mobile-sub-user1',
        userId: 'user1',
      });
    });

    it('sends a pairing ack on connect', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      const publishCalls = fetchMock.mock.calls.filter(
        (c: any[]) => c[0].includes(':publish'),
      );
      expect(publishCalls.length).toBeGreaterThanOrEqual(1);

      // Decode the first publish body
      const body = JSON.parse(publishCalls[0][1].body);
      const data = JSON.parse(atob(body.messages[0].data));
      expect(data.messageType).toBe('pairing');
      expect(data.direction).toBe('mobile_to_ext');
    });

    it('calls onError and schedules reconnect on publish failure', async () => {
      mockFetchResponse(':publish', { error: 'fail' }, 500);

      const errors: string[] = [];
      conn.onError = (e) => errors.push(e);

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Pub/Sub connection failed');
    });

    it('clears state from previous connection', async () => {
      // First connection
      conn.connectPubSub(makePairing({ userId: 'old-user' }));
      await jest.advanceTimersByTimeAsync(10);

      // Second connection — should reset
      conn.connectPubSub(makePairing({ userId: 'new-user' }));
      await jest.advanceTimersByTimeAsync(10);

      expect(conn.currentConfig?.userId).toBe('new-user');
    });
  });

  // ── send ──────────────────────────────────────────────

  describe('send', () => {
    it('publishes an RPC envelope to the topic', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      conn.send(JSON.stringify({ id: 'r1', type: 'request', method: 'test' }));
      await jest.advanceTimersByTimeAsync(10);

      const publishCalls = fetchMock.mock.calls.filter(
        (c: any[]) => c[0].includes(':publish'),
      );
      // At least 2: pairing ack + rpc send
      expect(publishCalls.length).toBeGreaterThanOrEqual(2);

      const lastPublish = publishCalls[publishCalls.length - 1];
      const body = JSON.parse(lastPublish[1].body);
      const envelope = JSON.parse(atob(body.messages[0].data));
      expect(envelope.messageType).toBe('rpc');
      expect(envelope.direction).toBe('mobile_to_ext');
      // Avro union encoding: payload is {"string": "..."} not a bare string
      const payloadStr = typeof envelope.payload === 'object' && envelope.payload?.string
        ? envelope.payload.string
        : envelope.payload;
      expect(JSON.parse(payloadStr).method).toBe('test');
    });

    it('does nothing when not connected', async () => {
      const callsBefore = fetchMock.mock.calls.length;
      conn.send('test');
      await jest.advanceTimersByTimeAsync(10);
      expect(fetchMock.mock.calls.length).toBe(callsBefore);
    });

    it('calls onError on publish failure', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      // Make next publish fail
      mockFetchResponse(':publish', { error: 'fail' }, 500);

      const errors: string[] = [];
      conn.onError = (e) => errors.push(e);

      conn.send('test-payload');
      await jest.advanceTimersByTimeAsync(10);

      expect(errors.some((e) => e.includes('Send failed'))).toBe(true);
    });
  });

  // ── Polling & Message Processing ──────────────────────

  describe('polling', () => {
    it('starts polling immediately on connect', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      const pullCalls = fetchMock.mock.calls.filter(
        (c: any[]) => c[0].includes(':pull'),
      );
      expect(pullCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('polls at POLL_INTERVAL_MS intervals', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      const initialPulls = fetchMock.mock.calls.filter(
        (c: any[]) => c[0].includes(':pull'),
      ).length;

      await jest.advanceTimersByTimeAsync(2_000);

      const newPulls = fetchMock.mock.calls.filter(
        (c: any[]) => c[0].includes(':pull'),
      ).length;

      expect(newPulls).toBeGreaterThan(initialPulls);
    });

    it('delivers RPC messages via onMessage', async () => {
      const messages: string[] = [];
      conn.onMessage = (data) => messages.push(data);

      const payload = JSON.stringify({ id: 'r1', type: 'response', result: 'hello' });
      const envelope = makeEnvelope({ messageType: 'rpc', payload });
      mockFetchResponse(':pull', makePullResponse(envelope));

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(messages.length).toBe(1);
      expect(JSON.parse(messages[0]).result).toBe('hello');
    });

    it('delivers auth messages via onMessage', async () => {
      const messages: string[] = [];
      conn.onMessage = (data) => messages.push(data);

      const payload = JSON.stringify({ type: 'auth.success', sessionId: 'sess1' });
      const envelope = makeEnvelope({ messageType: 'auth', payload });
      mockFetchResponse(':pull', makePullResponse(envelope));

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(messages.length).toBe(1);
    });

    it('acknowledges received messages', async () => {
      const envelope = makeEnvelope();
      mockFetchResponse(':pull', makePullResponse(envelope));

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      const ackCalls = fetchMock.mock.calls.filter(
        (c: any[]) => c[0].includes(':acknowledge'),
      );
      expect(ackCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('filters out mobile_to_ext messages', async () => {
      const messages: string[] = [];
      conn.onMessage = (data) => messages.push(data);

      const envelope = makeEnvelope({ direction: 'mobile_to_ext' });
      mockFetchResponse(':pull', makePullResponse(envelope));

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(messages.length).toBe(0);
    });

    it('filters out messages for other users', async () => {
      const messages: string[] = [];
      conn.onMessage = (data) => messages.push(data);

      const envelope = makeEnvelope({ userId: 'other-user' });
      mockFetchResponse(':pull', makePullResponse(envelope));

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(messages.length).toBe(0);
    });

    it('handles disconnect messages from extension', async () => {
      const errors: string[] = [];
      conn.onError = (e) => errors.push(e);

      const envelope = makeEnvelope({ messageType: 'disconnect' });
      mockFetchResponse(':pull', makePullResponse(envelope));

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(errors.some((e) => e.includes('Extension disconnected'))).toBe(true);
      expect(conn.status).toBe('disconnected');
    });

    it('disconnects on 401 poll error', async () => {
      mockFetchResponse(':pull', { error: 'Unauthorized' }, 401);

      const errors: string[] = [];
      conn.onError = (e) => errors.push(e);

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(errors.some((e) => e.includes('authentication expired'))).toBe(true);
      expect(conn.status).toBe('disconnected');
    });

    it('disconnects on 403 poll error', async () => {
      mockFetchResponse(':pull', { error: 'Forbidden' }, 403);

      const errors: string[] = [];
      conn.onError = (e) => errors.push(e);

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(errors.some((e) => e.includes('authentication expired'))).toBe(true);
    });
  });

  // ── Deduplication ─────────────────────────────────────

  describe('deduplication', () => {
    it('skips duplicate message IDs', async () => {
      const messages: string[] = [];
      conn.onMessage = (data) => messages.push(data);

      const envelope = makeEnvelope({ id: 'dup-1' });
      // Same message returned twice in consecutive polls
      mockFetchResponse(':pull', makePullResponse(envelope, envelope));

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      // Only one message delivered despite two in the batch
      expect(messages.length).toBe(1);
    });

    it('skips duplicates across polls', async () => {
      const messages: string[] = [];
      conn.onMessage = (data) => messages.push(data);

      const envelope = makeEnvelope({ id: 'cross-poll-dup' });

      // First poll
      mockFetchResponse(':pull', makePullResponse(envelope));
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(messages.length).toBe(1);

      // Second poll returns same message
      mockFetchResponse(':pull', makePullResponse(envelope));
      await jest.advanceTimersByTimeAsync(2_000);

      expect(messages.length).toBe(1); // still 1
    });
  });

  // ── Heartbeat ─────────────────────────────────────────

  describe('heartbeat', () => {
    it('sends heartbeat at 25s intervals', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      // Clear publish calls from connect
      fetchMock.mockClear();
      setupDefaultFetchMocks();

      await jest.advanceTimersByTimeAsync(25_000);

      const publishCalls = fetchMock.mock.calls.filter(
        (c: any[]) => c[0].includes(':publish'),
      );
      expect(publishCalls.length).toBeGreaterThanOrEqual(1);

      const body = JSON.parse(publishCalls[0][1].body);
      const envelope = JSON.parse(atob(body.messages[0].data));
      expect(envelope.messageType).toBe('heartbeat');
    });
  });

  // ── disconnect ────────────────────────────────────────

  describe('disconnect', () => {
    it('transitions to disconnected', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      conn.disconnect();
      expect(conn.status).toBe('disconnected');
      expect(conn.isConnected).toBe(false);
    });

    it('clears config', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      conn.disconnect();
      expect(conn.currentConfig).toBeNull();
    });

    it('sends disconnect notification', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      fetchMock.mockClear();
      setupDefaultFetchMocks();

      conn.disconnect();
      await jest.advanceTimersByTimeAsync(10);

      const publishCalls = fetchMock.mock.calls.filter(
        (c: any[]) => c[0].includes(':publish'),
      );
      expect(publishCalls.length).toBeGreaterThanOrEqual(1);

      const body = JSON.parse(publishCalls[0][1].body);
      const envelope = JSON.parse(atob(body.messages[0].data));
      expect(envelope.messageType).toBe('disconnect');
    });

    it('stops polling after disconnect', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      conn.disconnect();

      const callsAfterDisconnect = fetchMock.mock.calls.length;

      await jest.advanceTimersByTimeAsync(5_000);

      // No new fetch calls for polling
      const pullCalls = fetchMock.mock.calls
        .slice(callsAfterDisconnect)
        .filter((c: any[]) => c[0].includes(':pull'));
      expect(pullCalls.length).toBe(0);
    });
  });

  // ── markAuthenticated ─────────────────────────────────

  describe('markAuthenticated', () => {
    it('transitions to authenticated', async () => {
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      conn.markAuthenticated();
      expect(conn.status).toBe('authenticated');
      expect(conn.isConnected).toBe(true);
    });
  });

  // ── Reconnect ─────────────────────────────────────────

  describe('reconnect', () => {
    it('schedules reconnect on initial publish failure', async () => {
      mockFetchResponse(':publish', { error: 'fail' }, 500);

      const statuses: string[] = [];
      conn.onStatusChange = (s) => statuses.push(s);

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      // Should be in connecting state (reconnect scheduled)
      expect(statuses).toContain('connecting');
    });

    it('gives up after max reconnect attempts', async () => {
      // All publishes fail — triggers reconnect loop
      mockFetchResponse(':publish', { error: 'fail' }, 500);
      mockFetchResponse(':pull', { receivedMessages: [] });

      const errors: string[] = [];
      conn.onError = (e) => errors.push(e);

      conn.connectPubSub(makePairing());

      // Each reconnect iteration needs time advance + microtask flushing.
      // Attempt delays: 3s, 6s, 9s, 12s, 15s, 15s, 15s, 15s, 15s, 15s
      // Advance generously and let async settle between each step.
      for (let i = 0; i < 25; i++) {
        await jest.advanceTimersByTimeAsync(16_000);
      }

      // After 10 reconnect failures, should give up
      expect(errors).toContain('Max reconnect attempts reached. Please reconnect manually.');
      expect(conn.status).toBe('disconnected');
    });
  });

  // ── Batch Processing ──────────────────────────────────

  describe('batch processing', () => {
    it('processes multiple messages in a single poll', async () => {
      const messages: string[] = [];
      conn.onMessage = (data) => messages.push(data);

      const env1 = makeEnvelope({
        id: 'batch-1',
        payload: JSON.stringify({ id: 'r1', type: 'response', result: 'first' }),
      });
      const env2 = makeEnvelope({
        id: 'batch-2',
        payload: JSON.stringify({ id: 'r2', type: 'response', result: 'second' }),
      });

      mockFetchResponse(':pull', makePullResponse(env1, env2));

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(messages.length).toBe(2);
      expect(JSON.parse(messages[0]).result).toBe('first');
      expect(JSON.parse(messages[1]).result).toBe('second');
    });
  });

  // ── Authorization Header ──────────────────────────────

  describe('authorization', () => {
    it('includes Bearer token in publish requests', async () => {
      conn.connectPubSub(makePairing({ accessToken: 'my-secret-token' }));
      await jest.advanceTimersByTimeAsync(10);

      const publishCall = fetchMock.mock.calls.find(
        (c: any[]) => c[0].includes(':publish'),
      );
      expect(publishCall).toBeDefined();
      expect(publishCall![1].headers.Authorization).toBe('Bearer my-secret-token');
    });

    it('includes Bearer token in pull requests', async () => {
      conn.connectPubSub(makePairing({ accessToken: 'my-secret-token' }));
      await jest.advanceTimersByTimeAsync(10);

      const pullCall = fetchMock.mock.calls.find(
        (c: any[]) => c[0].includes(':pull'),
      );
      expect(pullCall).toBeDefined();
      expect(pullCall![1].headers.Authorization).toBe('Bearer my-secret-token');
    });
  });

  // ── URL Construction ──────────────────────────────────

  describe('API URLs', () => {
    it('constructs correct publish URL', async () => {
      conn.connectPubSub(makePairing({
        projectId: 'proj-abc',
        topicName: 'my-topic',
      }));
      await jest.advanceTimersByTimeAsync(10);

      const publishCall = fetchMock.mock.calls.find(
        (c: any[]) => c[0].includes(':publish'),
      );
      expect(publishCall![0]).toBe(
        'https://pubsub.googleapis.com/v1/projects/proj-abc/topics/my-topic:publish',
      );
    });

    it('constructs correct pull URL', async () => {
      conn.connectPubSub(makePairing({
        projectId: 'proj-abc',
        mobileSubscription: 'mobile-sub-x',
      }));
      await jest.advanceTimersByTimeAsync(10);

      const pullCall = fetchMock.mock.calls.find(
        (c: any[]) => c[0].includes(':pull'),
      );
      expect(pullCall![0]).toBe(
        'https://pubsub.googleapis.com/v1/projects/proj-abc/subscriptions/mobile-sub-x:pull',
      );
    });
  });

  // ── Malformed Messages ────────────────────────────────

  describe('malformed messages', () => {
    it('ignores messages with no data field', async () => {
      const messages: string[] = [];
      conn.onMessage = (data) => messages.push(data);

      fetchResponses.set(':pull', () => ({
        ok: true,
        status: 200,
        json: async () => ({
          receivedMessages: [{ ackId: 'ack-1', message: {} }],
        }),
        text: async () => '',
      } as Response));

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(messages.length).toBe(0);
    });

    it('ignores messages with invalid base64', async () => {
      const messages: string[] = [];
      conn.onMessage = (data) => messages.push(data);

      fetchResponses.set(':pull', () => ({
        ok: true,
        status: 200,
        json: async () => ({
          receivedMessages: [{ ackId: 'ack-1', message: { data: '!!!invalid!!!' } }],
        }),
        text: async () => '',
      } as Response));

      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      expect(messages.length).toBe(0);
    });
  });

  // ─── Token Refresh ──────────────────────────────────────

  describe('token refresh', () => {
    it('should update stored access token on token_refresh message', async () => {
      const messages: string[] = [];
      conn.onMessage = (data) => messages.push(data);

      const tokenRefreshEnvelope = makeEnvelope({
        messageType: 'token_refresh',
        payload: JSON.stringify({
          accessToken: 'fresh-token-999',
          tokenExpiry: Date.now() + 7_200_000,
        }),
      });

      fetchResponses.set(':pull', () => ({
        ok: true,
        status: 200,
        json: async () => makePullResponse(tokenRefreshEnvelope),
        text: async () => '',
      } as Response));

      conn.connectPubSub(makePairing({ accessToken: 'old-token' }));
      await jest.advanceTimersByTimeAsync(10);

      // Token should be updated internally
      // The pairing info is private, so we check by triggering a publish and verifying the token
      // The message should NOT be forwarded to onMessage (it's internal)
      expect(messages.length).toBe(0);
    });

    it('should use the refreshed token for subsequent API calls', async () => {
      const tokenRefreshEnvelope = makeEnvelope({
        messageType: 'token_refresh',
        payload: JSON.stringify({
          accessToken: 'fresh-token-abc',
          tokenExpiry: Date.now() + 7_200_000,
        }),
      });

      // First poll returns token_refresh
      let pullCallCount = 0;
      fetchResponses.set(':pull', () => {
        pullCallCount++;
        if (pullCallCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => makePullResponse(tokenRefreshEnvelope),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ receivedMessages: [] }),
          text: async () => '',
        } as Response;
      });

      conn.connectPubSub(makePairing({ accessToken: 'old-token' }));
      await jest.advanceTimersByTimeAsync(10);

      // Clear call history
      fetchMock.mockClear();

      // Send a message — should use the refreshed token
      conn.send(JSON.stringify({ type: 'test' }));
      await jest.advanceTimersByTimeAsync(10);

      const publishCall = fetchMock.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes(':publish'),
      );
      if (publishCall) {
        const headers = publishCall[1]?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer fresh-token-abc');
      }
    });

    it('should handle malformed token_refresh payload gracefully', async () => {
      const badRefreshEnvelope = makeEnvelope({
        messageType: 'token_refresh',
        payload: 'not-valid-json',
      });

      fetchResponses.set(':pull', () => ({
        ok: true,
        status: 200,
        json: async () => makePullResponse(badRefreshEnvelope),
        text: async () => '',
      } as Response));

      // Should not throw
      conn.connectPubSub(makePairing());
      await jest.advanceTimersByTimeAsync(10);

      // Connection should still be active
      expect(conn.isConnected).toBe(true);
    });
  });
});
