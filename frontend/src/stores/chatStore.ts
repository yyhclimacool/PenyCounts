import { create } from 'zustand';

import type { ChatMessage } from '@/types';
import {
  chat as streamChat,
  clearChatHistory,
  getChatHistory,
} from '@/services/ai';
import { useDataStore } from '@/stores/dataStore';

export interface ChatMessageUI extends ChatMessage {
  isStreaming?: boolean;
}

const TOOL_ACTION_LABELS: Record<string, string> = {
  create_transaction: '记账',
  update_transaction: '修改账单',
  delete_transaction: '删除账单',
  create_social_gift: '记录人情',
  update_social_gift: '修改人情',
  delete_social_gift: '删除人情',
};

interface ChatState {
  messages: ChatMessageUI[];
  isOpen: boolean;
  isLoading: boolean;
  historyLoaded: boolean;

  setOpen: (open: boolean) => void;
  clearMessages: () => Promise<void>;
  loadHistory: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  isLoading: false,
  historyLoaded: false,

  setOpen: (isOpen) => set({ isOpen }),

  clearMessages: async () => {
    // Clear UI immediately so the user gets instant feedback. historyLoaded
    // stays true to prevent loadHistory() from re-fetching stale messages.
    set({ messages: [], historyLoaded: true, isLoading: false });
    try {
      // Also wipe the server-side chat history, otherwise the next message
      // would still send the old conversation as context to the model.
      await clearChatHistory();
    } catch {
      /* clearing server history failed; UI is already cleared */
    }
  },

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
            // AI tools可创建/修改交易、成员、社交礼金，统一失效相关数据
            useDataStore.getState().invalidateTransactions();
            useDataStore.getState().invalidateMembers();
            useDataStore.getState().invalidateSocialGifts();
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
            const action = (data.tool && TOOL_ACTION_LABELS[data.tool]) || '操作';
            full += `\n\n${action}失败: ${data.error}`;
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
