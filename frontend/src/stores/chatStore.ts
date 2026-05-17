import { create } from 'zustand';

import type { ChatMessage } from '@/types';
import { chat as streamChat, getChatHistory } from '@/services/ai';

export interface ChatMessageUI extends ChatMessage {
  isStreaming?: boolean;
}

interface ChatState {
  messages: ChatMessageUI[];
  isOpen: boolean;
  isLoading: boolean;
  historyLoaded: boolean;

  setOpen: (open: boolean) => void;
  clearMessages: () => void;
  loadHistory: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  isLoading: false,
  historyLoaded: false,

  setOpen: (isOpen) => set({ isOpen }),

  clearMessages: () => set({ messages: [], historyLoaded: false }),

  loadHistory: async () => {
    if (get().historyLoaded) return;
    set({ historyLoaded: true });
    try {
      const history = await getChatHistory();
      set((s) => {
        if (s.messages.length === 0) return { messages: history };
        return { messages: [...history, ...s.messages] };
      });
    } catch {
      /* history load failure is non-critical */
    }
  },

  sendMessage: async (text) => {
    if (get().isLoading) return;
    set({ isLoading: true });

    const userMsg: ChatMessageUI = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));

    const assistantMsg: ChatMessageUI = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
      isStreaming: true,
    };
    set((s) => ({ messages: [...s.messages, assistantMsg] }));

    let full = '';

    await streamChat(
      text,
      {
        onDelta: (chunk) => {
          full += chunk;
          const content = full;
          set((s) => {
            const msgs = s.messages.slice();
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].isStreaming) {
                msgs[i] = { ...msgs[i], content };
                break;
              }
            }
            return { messages: msgs };
          });
        },
        onToolResult: (data) => {
          if (data.summary) {
            full += data.summary;
            const content = full;
            set((s) => {
              const msgs = s.messages.slice();
              for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].isStreaming) {
                  msgs[i] = { ...msgs[i], content };
                  break;
                }
              }
              return { messages: msgs };
            });
          } else if (data.error) {
            full += `\n\n记账失败: ${data.error}`;
            const content = full;
            set((s) => {
              const msgs = s.messages.slice();
              for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].isStreaming) {
                  msgs[i] = { ...msgs[i], content };
                  break;
                }
              }
              return { messages: msgs };
            });
          }
        },
        onError: (err) => {
          set((s) => {
            const msgs = s.messages.slice();
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].isStreaming) {
                msgs[i] = {
                  ...msgs[i],
                  content: full || `抱歉，发生了错误：${err.message}`,
                };
                break;
              }
            }
            return { messages: msgs };
          });
        },
        onDone: () => {
          set((s) => ({
            isLoading: false,
            messages: s.messages.map((m) =>
              m.isStreaming ? { ...m, isStreaming: false } : m,
            ),
          }));
        },
      },
    );
  },
}));
