/**
 * Connection slice — manages transport state, relay/pubsub connections.
 */

import { StateCreator } from 'zustand';
import { ConnectionManager, ConnectionStatus } from '../api/connection';
import { PubSubConnection, PubSubPairingInfo } from '../api/pubsub';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TransportType = 'relay' | 'pubsub';

export interface ConnectionSlice {
  // State
  connectionStatus: ConnectionStatus;
  sessionId: string | null;
  token: string | null;
  relayUrl: string | null;
  relayCode: string | null;
  connectionError: string | null;
  transportType: TransportType;
  relayServerUrl: string;

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void;
  setConnectionError: (error: string | null) => void;
  setSessionId: (id: string | null) => void;
  setToken: (token: string | null) => void;
  setRelayConfig: (url: string | null, code: string | null) => void;
  setRelayServerUrl: (url: string) => void;

  connectDirect: (url: string, token: string) => void;
  connectRelayWithCode: (code: string) => void;
  connectRelay: (relayUrl: string, code: string) => void;
  connectPubSub: (pairing: PubSubPairingInfo) => void;
  disconnect: () => void;

  // Persistence
  saveCredentials: () => Promise<void>;
  loadCredentials: () => Promise<void>;
}

export const createConnectionSlice = (
  connectionManager: ConnectionManager,
  pubsubConnection: PubSubConnection,
  restoreRelayTransport: () => void,
  activatePubSubTransport: () => void,
  defaultRelayServer: string,
): StateCreator<ConnectionSlice & { [key: string]: any }, [], [], ConnectionSlice> =>
  (set, get) => ({
    connectionStatus: 'disconnected',
    sessionId: null,
    token: null,
    relayUrl: null,
    relayCode: null,
    connectionError: null,
    transportType: 'relay' as TransportType,
    relayServerUrl: defaultRelayServer,

    setConnectionStatus: (status) => set({ connectionStatus: status }),
    setConnectionError: (error) => set({ connectionError: error }),
    setSessionId: (id) => set({ sessionId: id }),
    setToken: (token) => set({ token }),
    setRelayConfig: (url, code) => set({ relayUrl: url, relayCode: code }),
    setRelayServerUrl: (url) => {
      set({ relayServerUrl: url });
      AsyncStorage.setItem('mc-relay-server', url).catch(() => {});
    },

    connectDirect: (url, token) => {
      pubsubConnection.disconnect();
      restoreRelayTransport();
      set({ token, connectionError: null, transportType: 'relay' });
      connectionManager.connectDirect(url, token);
    },

    connectRelayWithCode: (code) => {
      pubsubConnection.disconnect();
      restoreRelayTransport();
      const relayUrl = get().relayServerUrl;
      set({ relayUrl, relayCode: code, connectionError: null, transportType: 'relay' });
      get().loadChatHistory?.();
      connectionManager.connectRelay(relayUrl, code);
    },

    connectRelay: (relayUrl, code) => {
      pubsubConnection.disconnect();
      restoreRelayTransport();
      set({ relayUrl, relayCode: code, connectionError: null, transportType: 'relay' });
      get().loadChatHistory?.();
      connectionManager.connectRelay(relayUrl, code);
    },

    connectPubSub: (pairing) => {
      connectionManager.disconnect();
      activatePubSubTransport();
      set({
        transportType: 'pubsub',
        relayUrl: null,
        relayCode: pairing.userId,
        connectionError: null,
      });
      get().loadChatHistory?.();
      pubsubConnection.connectPubSub(pairing);
    },

    disconnect: () => {
      get().saveChatHistory?.();
      const transport = get().transportType;
      if (transport === 'pubsub') {
        pubsubConnection.disconnect();
      } else {
        connectionManager.disconnect();
      }
      get().rpc?.cancelAll();
      set({
        sessionId: null,
        token: null,
        relayUrl: null,
        relayCode: null,
        connectionError: null,
        workspace: null,
        agentWorking: false,
        isStreaming: false,
        messageQueue: [],
        messages: [],
      });
      Promise.all([
        AsyncStorage.removeItem('mc-session'),
        AsyncStorage.removeItem('mc-token'),
        AsyncStorage.removeItem('mc-relay-url'),
        AsyncStorage.removeItem('mc-relay-code'),
      ]).catch(() => {});
    },

    saveCredentials: async () => {
      const { sessionId, token, relayUrl, relayCode } = get();
      try {
        const pairs: [string, string][] = [];
        if (sessionId) pairs.push(['mc-session', sessionId]);
        if (token) pairs.push(['mc-token', token]);
        if (relayUrl) pairs.push(['mc-relay-url', relayUrl]);
        if (relayCode) pairs.push(['mc-relay-code', relayCode]);
        await Promise.all(pairs.map(([k, v]) => AsyncStorage.setItem(k, v)));
      } catch (e) {
        if (__DEV__) console.warn('[AppStore] saveCredentials failed:', e);
      }
    },

    loadCredentials: async () => {
      try {
        const keys = ['mc-session', 'mc-token', 'mc-relay-url', 'mc-relay-code', 'mc-theme', 'mc-mode', 'mc-model', 'mc-relay-server'];
        const values = await Promise.all(keys.map((k) => AsyncStorage.getItem(k)));
        const map: Record<string, string> = {};
        keys.forEach((k, i) => { if (values[i] !== null) map[k] = values[i]!; });

        set({
          sessionId: map['mc-session'] || null,
          token: map['mc-token'] || null,
          relayUrl: map['mc-relay-url'] || null,
          relayCode: map['mc-relay-code'] || null,
          relayServerUrl: map['mc-relay-server'] || defaultRelayServer,
          theme: (map['mc-theme'] as any) || 'dark',
          chatMode: (map['mc-mode'] as any) || 'agent',
          selectedModel: map['mc-model'] || 'gpt-4o',
        });

        if (map['mc-session']) {
          get().rpc.sessionId = map['mc-session'];
        }
      } catch (e) {
        if (__DEV__) console.warn('[AppStore] loadCredentials failed:', e);
      }
    },
  });
