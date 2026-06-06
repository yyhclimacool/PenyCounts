import type { ChatMessage, LlmConfig } from '@/types';
import { AUTH_TOKEN_KEY, api } from './api';

export async function getConfig(): Promise<LlmConfig> {
  const { data } = await api.get<LlmConfig>('/ai/config');
  return data;
}

export async function saveConfig(payload: Partial<LlmConfig>): Promise<LlmConfig> {
  const { data } = await api.put<LlmConfig>('/ai/config', payload);
  return data;
}

export async function testConnection(payload: {
  api_url: string;
  api_key?: string | null;
  model_name: string;
}): Promise<{ success: boolean; reply?: string; error?: string }> {
  const { data } = await api.post('/ai/test-connection', payload);
  return data;
}

export async function getChatHistory(): Promise<ChatMessage[]> {
  const { data } = await api.get<ChatMessage[]>('/ai/chat/history');
  return data;
}

export async function clearChatHistory(): Promise<void> {
  await api.delete('/ai/chat/history');
}

function resolveChatRequestUrl(): string {
  const base = import.meta.env.VITE_API_URL ?? '/api';
  const suffix = '/ai/chat';
  if (/^https?:\/\//i.test(base)) {
    return `${base.replace(/\/$/, '')}${suffix}`;
  }
  return `${base.replace(/\/$/, '')}${suffix}`;
}

export interface ChatStreamOptions {
  onDelta?: (chunk: string) => void;
  onToolResult?: (data: { success: boolean; summary?: string; error?: string }) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Streams assistant output via POST + SSE-style lines (fetch; EventSource cannot POST with body).
 */
export async function chat(
  message: string,
  options: ChatStreamOptions = {},
  signal?: AbortSignal,
): Promise<void> {
  const { onDelta, onToolResult, onDone, onError } = options;
  const url = resolveChatRequestUrl();
  const token = localStorage.getItem(AUTH_TOKEN_KEY);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message }),
      signal,
    });
  } catch (e) {
    onError?.(e instanceof Error ? e : new Error(String(e)));
    onDone?.();
    return;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    onError?.(new Error(text || `请求失败 (${res.status})`));
    onDone?.();
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onError?.(new Error('响应体不可读'));
    onDone?.();
    return;
  }

  const decoder = new TextDecoder();
  let carry = '';
  let currentEvent = 'message';
  // Accumulates the `data:` lines of the current SSE event. Per the SSE spec,
  // a single event may span multiple data lines that must be re-joined with
  // '\n' — this is exactly how newlines inside a streamed token arrive.
  let dataLines: string[] = [];

  const dispatchEvent = () => {
    const evt = currentEvent;
    const lines = dataLines;
    currentEvent = 'message';
    dataLines = [];

    if (lines.length === 0) return;
    const payload = lines.join('\n');
    if (payload === '[DONE]') return;

    if (evt === 'error') {
      onError?.(new Error(payload));
      return;
    }

    if (evt === 'tool_result') {
      try {
        onToolResult?.(JSON.parse(payload));
      } catch { /* ignore parse errors */ }
      return;
    }

    let chunk = '';
    if (payload.startsWith('{') || payload.startsWith('[')) {
      try {
        const obj = JSON.parse(payload) as {
          content?: string;
          delta?: string;
          text?: string;
          choices?: { delta?: { content?: string } }[];
        };
        chunk =
          obj.delta ??
          obj.content ??
          obj.text ??
          obj.choices?.[0]?.delta?.content ??
          '';
      } catch {
        chunk = payload;
      }
    } else {
      chunk = payload;
    }
    if (chunk) onDelta?.(chunk);
  };

  const handleLine = (raw: string) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    // Blank line terminates the current event.
    if (line === '') {
      dispatchEvent();
      return;
    }
    // Comment / keep-alive heartbeat.
    if (line.startsWith(':')) return;

    if (line.startsWith('event:')) {
      let name = line.slice(6);
      if (name.startsWith(' ')) name = name.slice(1);
      currentEvent = name;
      return;
    }

    if (line.startsWith('data:')) {
      let value = line.slice(5);
      // SSE: strip exactly one leading space, never trim the content itself.
      if (value.startsWith(' ')) value = value.slice(1);
      dataLines.push(value);
      return;
    }
    // Other fields (id:, retry:) are ignored.
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const parts = carry.split('\n');
      carry = parts.pop() ?? '';
      for (const raw of parts) {
        handleLine(raw);
      }
    }
    // Flush any trailing partial line + the final un-terminated event.
    if (carry) handleLine(carry);
    dispatchEvent();
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return;
    }
    onError?.(e instanceof Error ? e : new Error(String(e)));
  } finally {
    onDone?.();
  }
}
