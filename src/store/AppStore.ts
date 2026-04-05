/**
 * Global application store using Zustand.
 * Manages connection state, chat messages, workspace data, and settings.
 */

import { create } from 'zustand';
import { AppState as RNAppState, AppStateStatus } from 'react-native';
import { ConnectionManager, ConnectionStatus } from '../api/connection';
import { PubSubConnection, PubSubPairingInfo } from '../api/pubsub';
import { RpcClient } from '../api/rpc';
import { ThemeMode } from '../theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NotificationService } from '../api/notifications';

// ─── Types ──────────────────────────────────────────────

/** Active transport layer. */
export type TransportType = 'relay' | 'pubsub';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  language?: string;
}

export interface DiagnosticInfo {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
  code?: string | number;
}

export interface GitChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  diff?: string;
}

export interface WorkspaceInfo {
  name: string;
  rootPath: string;
  gitBranch?: string;
  diagnosticsSummary?: { errors: number; warnings: number };
}

export type ChatMode = 'agent' | 'chat';

export interface QueuedMessage {
  id: string;
  text: string;
  mode: ChatMode;
  timestamp: number;
  position: number;
}

// ─── Store Interface ────────────────────────────────────

/**
 * Default relay server URL.
 * Override at build time: EXPO_PUBLIC_RELAY_URL=wss://relay.example.com
 * Override at runtime: Settings screen.
 */
const DEFAULT_RELAY_SERVER = process.env.EXPO_PUBLIC_RELAY_URL || 'wss://gopilot-relay.onrender.com';

interface AppState {
  // Connection
  connectionStatus: ConnectionStatus;
  sessionId: string | null;
  token: string | null;
  relayUrl: string | null;
  relayCode: string | null;
  connectionError: string | null;
  transportType: TransportType;

  /** App-level relay server URL (persisted in settings). */
  relayServerUrl: string;

  // Chat
  messages: ChatMessage[];
  chatMode: ChatMode;
  selectedModel: string;
  isStreaming: boolean;
  streamingContent: string;
  agentWorking: boolean;

  // Message queue — holds prompts sent while agent/chat is busy
  messageQueue: QueuedMessage[];

  // Workspace
  workspace: WorkspaceInfo | null;
  diagnosticsSummary: { errors: number; warnings: number };

  // Notifications
  unreadCount: number;
  activeScreen: string;

  // Settings
  theme: ThemeMode;

  // Singleton API instances
  connection: ConnectionManager;
  pubsub: PubSubConnection;
  rpc: RpcClient;

  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void;
  setConnectionError: (error: string | null) => void;
  setSessionId: (id: string | null) => void;
  setToken: (token: string | null) => void;
  setRelayConfig: (url: string | null, code: string | null) => void;

  addMessage: (msg: ChatMessage) => void;
  clearMessages: () => void;
  setStreaming: (streaming: boolean, content?: string) => void;
  appendStreamContent: (chunk: string) => void;
  setChatMode: (mode: ChatMode) => void;
  setSelectedModel: (model: string) => void;
  setAgentWorking: (working: boolean) => void;

  enqueueMessage: (text: string, mode: ChatMode) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;

  setWorkspace: (info: WorkspaceInfo | null) => void;
  setDiagnosticsSummary: (summary: { errors: number; warnings: number }) => void;

  setTheme: (theme: ThemeMode) => void;
  setRelayServerUrl: (url: string) => void;

  clearUnread: () => void;
  setActiveScreen: (screen: string) => void;

  // Complex actions
  connectDirect: (url: string, token: string) => void;
  /** Connect via relay using only a room code (uses app-level relayServerUrl). */
  connectRelayWithCode: (code: string) => void;
  /** Connect via relay with explicit URL + code (used by auto-reconnect). */
  connectRelay: (relayUrl: string, code: string) => void;
  /** Connect via Pub/Sub using pairing info (from QR code or manual entry). */
  connectPubSub: (pairing: PubSubPairingInfo) => void;
  disconnect: () => void;
  sendChatMessage: (text: string) => Promise<void>;
  sendAgentMessage: (text: string) => Promise<void>;
  /** Send or queue — queues if agent/chat is busy, sends immediately otherwise. */
  sendOrQueue: (text: string) => void;
  loadWorkspaceInfo: () => Promise<void>;
  loadDiagnostics: () => Promise<DiagnosticInfo[]>;
  loadFileTree: (dirPath?: string) => Promise<FileInfo[]>;
  readFile: (path: string) => Promise<string>;
  runTerminalCommand: (command: string) => Promise<{ output: string; exitCode?: number }>;
  loadChanges: () => Promise<{ files: GitChange[]; summary: any }>;
  restoreFiles: (files: string[]) => Promise<any>;
  revertHunks: (filePath: string, hunkIndices: number[], diff: string) => Promise<any>;

  // Persistence
  saveCredentials: () => Promise<void>;
  loadCredentials: () => Promise<void>;
  saveChatHistory: () => Promise<void>;
  loadChatHistory: () => Promise<void>;
}

// ─── Store ──────────────────────────────────────────────

const connectionManager = new ConnectionManager();
const pubsubConnection = new PubSubConnection();
const rpcClient = new RpcClient(connectionManager);
const notificationService = new NotificationService();

// Debounce timer for saveChatHistory — prevents excessive AsyncStorage writes
let _saveChatTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_CHAT_DEBOUNCE_MS = 1000;

// Store original ConnectionManager methods for relay mode restoration
const _originalSend = connectionManager.send.bind(connectionManager);
const _originalMarkAuth = connectionManager.markAuthenticated.bind(connectionManager);

/** Restore ConnectionManager to use its native WebSocket transport. */
function restoreRelayTransport(): void {
  connectionManager.send = _originalSend;
  connectionManager.markAuthenticated = _originalMarkAuth;
}

/** Redirect ConnectionManager send/markAuthenticated to PubSubConnection. */
function activatePubSubTransport(): void {
  connectionManager.send = (data: string) => pubsubConnection.send(data);
  connectionManager.markAuthenticated = () => pubsubConnection.markAuthenticated();
  pubsubConnection.onMessage = connectionManager.onMessage;
}

export const useAppStore = create<AppState>((set, get) => {
  // Wire up connection events
  connectionManager.onStatusChange = (status) => {
    set({ connectionStatus: status });
    if (status === 'disconnected') {
      set({ agentWorking: false, isStreaming: false });
    }
  };

  connectionManager.onError = (error) => {
    set({ connectionError: error });
  };

  // Wire up Pub/Sub connection events
  pubsubConnection.onStatusChange = (status) => {
    set({ connectionStatus: status });
    if (status === 'disconnected') {
      set({ agentWorking: false, isStreaming: false });
    }
  };

  pubsubConnection.onError = (error) => {
    set({ connectionError: error });
  };

  // Wire up RPC events
  rpcClient.onEvent = (method, params) => {
    const state = get();

    switch (method) {
      case 'connection.ready':
        // Server is ready — authenticate
        if (state.connectionStatus === 'connected') {
          if (state.sessionId) {
            rpcClient.authenticate(state.sessionId);
          } else if (state.token) {
            rpcClient.authenticate(undefined, state.token);
          }
        }
        break;

      case 'auth.success':
        set({ sessionId: params.sessionId, connectionError: null });
        rpcClient.sessionId = params.sessionId;
        connectionManager.markAuthenticated();
        state.saveCredentials();
        state.loadWorkspaceInfo();
        // Initialize notifications after successful auth
        notificationService.initialize().catch(() => {});
        break;

      case 'auth.failed':
        set({ connectionError: 'Authentication failed. Try reconnecting.' });
        break;

      case 'diagnostics.changed':
        set({ diagnosticsSummary: params });
        break;

      case 'session.missedResponse':
        if (params.content) {
          const missedMsg: ChatMessage = {
            role: 'assistant' as const,
            content: params.content,
            timestamp: params.timestamp || Date.now(),
          };
          // Use addMessage to trigger unread tracking + notifications
          get().addMessage(missedMsg);
        }
        break;

      case 'agent.status':
        if (params.status === 'completed' || params.status === 'failed') {
          set({ agentWorking: false, isStreaming: false });
          // Agent finished — try to drain queued messages immediately
          setTimeout(() => processQueue(), 500);
        }
        break;
    }
  };

  // ── Queue processor — drains one message at a time after current completes ──
  const processQueue = () => {
    const state = get();
    if (state.messageQueue.length === 0) return;
    if (state.isStreaming || state.agentWorking) return; // still busy

    const [next, ...rest] = state.messageQueue;
    // Renumber remaining
    set({ messageQueue: rest.map((m, i) => ({ ...m, position: i + 1 })) });

    if (next.mode === 'agent') {
      state.sendAgentMessage(next.text);
    } else {
      state.sendChatMessage(next.text);
    }
  };

  // ── Polling safety net: check every 2 s if queue can drain ──
  let queuePollTimer: ReturnType<typeof setInterval> | null = null;

  const startQueuePolling = () => {
    if (queuePollTimer) return; // already running
    queuePollTimer = setInterval(() => {
      processQueue();
    }, 2_000);
  };

  const stopQueuePolling = () => {
    if (queuePollTimer) {
      clearInterval(queuePollTimer);
      queuePollTimer = null;
    }
  };

  // Start polling immediately — it's cheap (no-ops when queue is empty)
  startQueuePolling();

  // ── AppState listener: pause/resume Pub/Sub polling on background/foreground ──
  let lastAppState: AppStateStatus = RNAppState.currentState ?? 'active';

  RNAppState.addEventListener('change', (nextState) => {
    const wasBackground = lastAppState.match(/inactive|background/);
    const isNowActive = nextState === 'active';
    lastAppState = nextState;

    const state = get();
    if (state.transportType !== 'pubsub') return; // Only relevant for Pub/Sub

    if (wasBackground && isNowActive) {
      // Returning to foreground — resume polling to pull accumulated messages
      pubsubConnection.startPolling();
      startQueuePolling();
    } else if (nextState.match(/inactive|background/)) {
      // Going to background — pause polling to save battery
      pubsubConnection.stopPolling();
      stopQueuePolling();
    }
  });

  return {
    // Initial state
    connectionStatus: 'disconnected',
    sessionId: null,
    token: null,
    relayUrl: null,
    relayCode: null,
    connectionError: null,
    transportType: 'relay' as TransportType,

    relayServerUrl: DEFAULT_RELAY_SERVER,

    messages: [],
    chatMode: 'agent',
    selectedModel: 'gpt-4o',
    isStreaming: false,
    streamingContent: '',
    agentWorking: false,

    messageQueue: [],

    workspace: null,
    diagnosticsSummary: { errors: 0, warnings: 0 },

    unreadCount: 0,
    activeScreen: 'Chat',

    theme: 'dark',

    connection: connectionManager,
    pubsub: pubsubConnection,
    rpc: rpcClient,

    // Simple setters
    setConnectionStatus: (status) => set({ connectionStatus: status }),
    setConnectionError: (error) => set({ connectionError: error }),
    setSessionId: (id) => set({ sessionId: id }),
    setToken: (token) => set({ token }),
    setRelayConfig: (url, code) => set({ relayUrl: url, relayCode: code }),

    addMessage: (msg) => {
      set((s) => ({ messages: [...s.messages, msg] }));
      get().saveChatHistory();
      // Track unread assistant messages when not on Chat screen
      if (msg.role === 'assistant') {
        const state = get();
        if (state.activeScreen !== 'Chat') {
          const newCount = state.unreadCount + 1;
          set({ unreadCount: newCount });
          notificationService.showMessageNotification(msg.content, newCount);
        }
      }
    },
    clearMessages: () => {
      set({ messages: [] });
      get().saveChatHistory();
    },
    setStreaming: (streaming, content) => set({
      isStreaming: streaming,
      streamingContent: content || '',
    }),
    appendStreamContent: (chunk) => set((s) => ({
      streamingContent: s.streamingContent + chunk,
    })),
    setChatMode: (mode) => set({ chatMode: mode }),
    setSelectedModel: (model) => set({ selectedModel: model }),
    setAgentWorking: (working) => set({ agentWorking: working }),

    enqueueMessage: (text, mode) => {
      const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      set((s) => {
        const position = s.messageQueue.length + 1;
        return { messageQueue: [...s.messageQueue, { id, text, mode, timestamp: Date.now(), position }] };
      });
    },

    removeFromQueue: (id) => {
      set((s) => {
        const filtered = s.messageQueue.filter((m) => m.id !== id);
        // Renumber positions
        return { messageQueue: filtered.map((m, i) => ({ ...m, position: i + 1 })) };
      });
    },

    clearQueue: () => set({ messageQueue: [] }),

    setWorkspace: (info) => set({ workspace: info }),
    setDiagnosticsSummary: (summary) => set({ diagnosticsSummary: summary }),

    setTheme: (theme) => {
      set({ theme });
      AsyncStorage.setItem('mc-theme', theme).catch(() => {});
    },

    setRelayServerUrl: (url) => {
      set({ relayServerUrl: url });
      AsyncStorage.setItem('mc-relay-server', url).catch(() => {});
    },

    clearUnread: () => {
      set({ unreadCount: 0 });
      notificationService.clearBadge();
    },

    setActiveScreen: (screen) => {
      set({ activeScreen: screen });
      // Clear unread when navigating to Chat
      if (screen === 'Chat') {
        set({ unreadCount: 0 });
        notificationService.clearBadge();
      }
    },

    // ─── Complex Actions ────────────────────────────────

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
      // Load chat history for this specific room code
      get().loadChatHistory();
      connectionManager.connectRelay(relayUrl, code);
    },

    connectRelay: (relayUrl, code) => {
      pubsubConnection.disconnect();
      restoreRelayTransport();
      set({ relayUrl, relayCode: code, connectionError: null, transportType: 'relay' });
      // Load chat history for this specific room code
      get().loadChatHistory();
      connectionManager.connectRelay(relayUrl, code);
    },

    connectPubSub: (pairing) => {
      // Disconnect any existing relay connection
      connectionManager.disconnect();

      // Redirect RPC traffic through Pub/Sub transport
      activatePubSubTransport();

      set({
        transportType: 'pubsub',
        relayUrl: null,
        relayCode: pairing.userId, // Use userId as the "code" for chat history keying
        connectionError: null,
      });
      get().loadChatHistory();
      pubsubConnection.connectPubSub(pairing);
    },

    disconnect: () => {
      // Save current chat history before clearing
      get().saveChatHistory();
      const transport = get().transportType;
      if (transport === 'pubsub') {
        pubsubConnection.disconnect();
      } else {
        connectionManager.disconnect();
      }
      rpcClient.cancelAll();
      stopQueuePolling();
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

    sendChatMessage: async (text) => {
      const state = get();
      if (!text.trim() || state.connectionStatus !== 'authenticated') return;

      // If already busy, queue it
      if (state.isStreaming || state.agentWorking) {
        state.enqueueMessage(text, 'chat');
        return;
      }

      // Add user message
      const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
      set((s) => ({ messages: [...s.messages, userMsg], isStreaming: true, streamingContent: '' }));
      state.saveChatHistory();

      try {
        const history = state.messages.slice(-20).map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }));

        const fullResponse = await rpcClient.stream(
          'chat.send',
          { prompt: text, history, model: state.selectedModel },
          (chunk) => {
            set((s) => ({ streamingContent: s.streamingContent + chunk }));
          },
        );

        const content = fullResponse || get().streamingContent;
        set((s) => ({
          messages: [...s.messages, { role: 'assistant', content, timestamp: Date.now() }],
          isStreaming: false,
          streamingContent: '',
        }));
        get().saveChatHistory();
      } catch (err: any) {
        const errorContent = `**Error:** ${err.message}`;
        set((s) => ({
          messages: [...s.messages, { role: 'assistant', content: errorContent, timestamp: Date.now() }],
          isStreaming: false,
          streamingContent: '',
        }));
        get().saveChatHistory();
      }

      // Process next queued message if any
      processQueue();
    },

    sendAgentMessage: async (text) => {
      const state = get();
      if (!text.trim() || state.connectionStatus !== 'authenticated') return;

      // If already busy, queue it
      if (state.isStreaming || state.agentWorking) {
        state.enqueueMessage(text, 'agent');
        return;
      }

      const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
      set((s) => ({
        messages: [...s.messages, userMsg],
        isStreaming: true,
        streamingContent: '',
        agentWorking: true,
      }));
      state.saveChatHistory();

      try {
        const fullResponse = await rpcClient.stream(
          'chat.sendToAgent',
          { prompt: text },
          (chunk) => {
            set((s) => ({ streamingContent: s.streamingContent + chunk }));
          },
        );

        const content = fullResponse || get().streamingContent;
        set((s) => ({
          messages: [...s.messages, { role: 'assistant', content, timestamp: Date.now() }],
          isStreaming: false,
          streamingContent: '',
          agentWorking: false,
        }));
        get().saveChatHistory();
      } catch (err: any) {
        const errorContent = `**Error:** ${err.message}`;
        set((s) => ({
          messages: [...s.messages, { role: 'assistant', content: errorContent, timestamp: Date.now() }],
          isStreaming: false,
          streamingContent: '',
          agentWorking: false,
        }));
        get().saveChatHistory();
      }

      // Process next queued message if any
      processQueue();
    },

    sendOrQueue: (text) => {
      const state = get();
      if (!text.trim() || state.connectionStatus !== 'authenticated') return;

      if (state.chatMode === 'agent') {
        state.sendAgentMessage(text);
      } else {
        state.sendChatMessage(text);
      }
    },

    loadWorkspaceInfo: async () => {
      try {
        const info = await rpcClient.request('workspace.info');
        set({ workspace: info });
      } catch {
        // Ignore
      }
    },

    loadDiagnostics: async () => {
      try {
        const [diags, summary] = await Promise.all([
          rpcClient.request('diagnostics.all'),
          rpcClient.request('diagnostics.summary'),
        ]);
        set({ diagnosticsSummary: summary });
        return diags || [];
      } catch {
        return [];
      }
    },

    loadFileTree: async (dirPath?: string) => {
      try {
        if (dirPath) {
          return await rpcClient.request('workspace.listDir', { path: dirPath });
        }
        return await rpcClient.request('workspace.fileTree', { maxDepth: 2 });
      } catch {
        return [];
      }
    },

    readFile: async (path: string) => {
      const result = await rpcClient.request('file.read', { path });
      return result.content;
    },

    runTerminalCommand: async (command: string) => {
      return await rpcClient.request('terminal.run', { command }, 60000);
    },

    loadChanges: async () => {
      return await rpcClient.request('git.changedFiles', {});
    },

    restoreFiles: async (files: string[]) => {
      return await rpcClient.request('git.restoreFiles', { files });
    },

    revertHunks: async (filePath: string, hunkIndices: number[], diff: string) => {
      return await rpcClient.request('git.revertHunks', { filePath, hunkIndices, diff });
    },

    // ─── Persistence ────────────────────────────────────

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
          relayServerUrl: map['mc-relay-server'] || DEFAULT_RELAY_SERVER,
          theme: (map['mc-theme'] as ThemeMode) || 'dark',
          chatMode: (map['mc-mode'] as ChatMode) || 'agent',
          selectedModel: map['mc-model'] || 'gpt-4o',
        });

        // Sync sessionId to RPC client for relay reconnection auth
        if (map['mc-session']) {
          rpcClient.sessionId = map['mc-session'];
        }
      } catch (e) {
        if (__DEV__) console.warn('[AppStore] loadCredentials failed:', e);
      }
    },

    saveChatHistory: async () => {
      // Debounce: coalesce rapid save calls during streaming / multi-message flows
      if (_saveChatTimer) clearTimeout(_saveChatTimer);
      _saveChatTimer = setTimeout(async () => {
        try {
          const { messages, relayCode } = get();
          const key = relayCode
            ? `mc-chat-history:${relayCode}`
            : 'mc-chat-history:direct';
          const msgs = messages.slice(-200);
          await AsyncStorage.setItem(key, JSON.stringify(msgs));
        } catch (e) {
          if (__DEV__) console.warn('[AppStore] saveChatHistory failed:', e);
        }
      }, SAVE_CHAT_DEBOUNCE_MS);
    },

    loadChatHistory: async () => {
      try {
        const { relayCode } = get();
        const key = relayCode
          ? `mc-chat-history:${relayCode}`
          : 'mc-chat-history:direct';
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const messages = JSON.parse(raw) as ChatMessage[];
          if (Array.isArray(messages) && messages.length > 0) {
            set({ messages });
            return;
          }
        }
        // No history for this room — start fresh
        set({ messages: [] });
      } catch (e) {
        if (__DEV__) console.warn('[AppStore] loadChatHistory failed:', e);
        set({ messages: [] });
      }
    },
  };
});
