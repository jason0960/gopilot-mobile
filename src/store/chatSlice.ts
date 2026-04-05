/**
 * Chat slice — manages messages, streaming, agent mode, and message queue.
 */

import { StateCreator } from 'zustand';
import { RpcClient } from '../api/rpc';
import { NotificationService } from '../api/notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ChatMode = 'agent' | 'chat';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface QueuedMessage {
  id: string;
  text: string;
  mode: ChatMode;
  timestamp: number;
  position: number;
}

export interface ChatSlice {
  // State
  messages: ChatMessage[];
  chatMode: ChatMode;
  selectedModel: string;
  isStreaming: boolean;
  streamingContent: string;
  agentWorking: boolean;
  messageQueue: QueuedMessage[];

  // Actions
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

  sendChatMessage: (text: string) => Promise<void>;
  sendAgentMessage: (text: string) => Promise<void>;
  sendOrQueue: (text: string) => void;

  // Persistence
  saveChatHistory: () => Promise<void>;
  loadChatHistory: () => Promise<void>;
}

/** Debounce timer for saveChatHistory */
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 1000;

export const createChatSlice = (
  rpcClient: RpcClient,
  notificationService: NotificationService,
  processQueue: () => void,
): StateCreator<ChatSlice & { [key: string]: any }, [], [], ChatSlice> =>
  (set, get) => ({
    messages: [],
    chatMode: 'agent',
    selectedModel: 'gpt-4o',
    isStreaming: false,
    streamingContent: '',
    agentWorking: false,
    messageQueue: [],

    addMessage: (msg) => {
      set((s: any) => ({ messages: [...s.messages, msg] }));
      get().saveChatHistory();
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

    appendStreamContent: (chunk) => set((s: any) => ({
      streamingContent: s.streamingContent + chunk,
    })),

    setChatMode: (mode) => set({ chatMode: mode }),
    setSelectedModel: (model) => set({ selectedModel: model }),
    setAgentWorking: (working) => set({ agentWorking: working }),

    enqueueMessage: (text, mode) => {
      const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      set((s: any) => {
        const position = s.messageQueue.length + 1;
        return { messageQueue: [...s.messageQueue, { id, text, mode, timestamp: Date.now(), position }] };
      });
    },

    removeFromQueue: (id) => {
      set((s: any) => {
        const filtered = s.messageQueue.filter((m: QueuedMessage) => m.id !== id);
        return { messageQueue: filtered.map((m: QueuedMessage, i: number) => ({ ...m, position: i + 1 })) };
      });
    },

    clearQueue: () => set({ messageQueue: [] }),

    sendChatMessage: async (text) => {
      const state = get();
      if (!text.trim() || state.connectionStatus !== 'authenticated') return;

      if (state.isStreaming || state.agentWorking) {
        state.enqueueMessage(text, 'chat');
        return;
      }

      const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
      set((s: any) => ({ messages: [...s.messages, userMsg], isStreaming: true, streamingContent: '' }));
      state.saveChatHistory();

      try {
        const history = state.messages.slice(-20).map((m) => ({
          role: m.role, content: m.content, timestamp: m.timestamp,
        }));

        const fullResponse = await rpcClient.stream(
          'chat.send',
          { prompt: text, history, model: state.selectedModel },
          (chunk) => {
            set((s: any) => ({ streamingContent: s.streamingContent + chunk }));
          },
        );

        const content = fullResponse || get().streamingContent;
        set((s: any) => ({
          messages: [...s.messages, { role: 'assistant', content, timestamp: Date.now() }],
          isStreaming: false,
          streamingContent: '',
        }));
        get().saveChatHistory();
      } catch (err: any) {
        const errorContent = `**Error:** ${err.message}`;
        set((s: any) => ({
          messages: [...s.messages, { role: 'assistant', content: errorContent, timestamp: Date.now() }],
          isStreaming: false,
          streamingContent: '',
        }));
        get().saveChatHistory();
      }

      processQueue();
    },

    sendAgentMessage: async (text) => {
      const state = get();
      if (!text.trim() || state.connectionStatus !== 'authenticated') return;

      if (state.isStreaming || state.agentWorking) {
        state.enqueueMessage(text, 'agent');
        return;
      }

      const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
      set((s: any) => ({
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
            set((s: any) => ({ streamingContent: s.streamingContent + chunk }));
          },
        );

        const content = fullResponse || get().streamingContent;
        set((s: any) => ({
          messages: [...s.messages, { role: 'assistant', content, timestamp: Date.now() }],
          isStreaming: false,
          streamingContent: '',
          agentWorking: false,
        }));
        get().saveChatHistory();
      } catch (err: any) {
        const errorContent = `**Error:** ${err.message}`;
        set((s: any) => ({
          messages: [...s.messages, { role: 'assistant', content: errorContent, timestamp: Date.now() }],
          isStreaming: false,
          streamingContent: '',
          agentWorking: false,
        }));
        get().saveChatHistory();
      }

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

    saveChatHistory: async () => {
      // Debounce: coalesce rapid save calls (e.g., during streaming)
      if (_saveTimer) clearTimeout(_saveTimer);
      _saveTimer = setTimeout(async () => {
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
      }, SAVE_DEBOUNCE_MS);
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
        set({ messages: [] });
      } catch (e) {
        if (__DEV__) console.warn('[AppStore] loadChatHistory failed:', e);
        set({ messages: [] });
      }
    },
  });
