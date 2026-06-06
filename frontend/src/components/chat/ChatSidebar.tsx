import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Send, Trash2, User, X } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/stores/chatStore';

/* ------------------------------------------------------------------ */
/*  Typing indicator (three animated dots)                            */
/* ------------------------------------------------------------------ */

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1 px-0.5">
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Markdown message renderer                                          */
/* ------------------------------------------------------------------ */

const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-1 mt-2.5 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1 mt-2.5 text-[0.9375rem] font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-current/30 pl-3 opacity-80">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2 border-current/15" />,
  code: ({ className, children }) => {
    const text = String(children);
    const isBlock = text.includes('\n') || /language-/.test(className ?? '');
    if (isBlock) {
      return <code className={cn('font-mono', className)}>{children}</code>;
    }
    return (
      <code className="rounded bg-black/10 px-1 py-0.5 text-[0.8125rem] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-1.5 overflow-x-auto rounded-md bg-black/10 p-2.5 text-xs leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-current/20 px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-current/20 px-2 py-1">{children}</td>
  ),
};

function MessageContent({ content, streaming }: { content: string; streaming?: boolean }) {
  if (!content) return null;

  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
      {streaming && (
        <span className="ml-0.5 inline-block h-[1.1em] w-[2px] animate-pulse bg-current align-middle" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ChatSidebar                                                       */
/* ------------------------------------------------------------------ */

export function ChatSidebar() {
  const {
    messages,
    isOpen,
    isLoading,
    setOpen,
    sendMessage,
    loadHistory,
    clearMessages,
  } = useChatStore();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
      setTimeout(() => textareaRef.current?.focus(), 320);
    }
  }, [isOpen, loadHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const handleClear = () => {
    if (messages.length === 0) return;
    if (!window.confirm('确定清空聊天记录吗？这会同时清除 AI 的对话上下文，且不可恢复。')) {
      return;
    }
    void clearMessages();
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 md:hidden',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setOpen(false)}
      />

      {/* Panel */}
      <aside
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-border bg-card shadow-2xl',
          'transition-transform duration-300 ease-in-out md:w-[400px]',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* ---- Header ---- */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-semibold text-foreground">AI 助手</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive disabled:opacity-40"
              onClick={handleClear}
              disabled={isLoading || messages.length === 0}
              title="清空聊天记录与上下文"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ---- Messages ---- */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-7 w-7 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">你好！我是 AI 记账助手</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                输入消息开始对话，我可以帮你快速记账、查询账单、分析支出趋势等
              </p>
            </div>
          )}

          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={cn('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}
              >
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    isUser
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                </div>

                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                    isUser
                      ? 'rounded-tr-md bg-primary text-primary-foreground'
                      : 'rounded-tl-md bg-muted text-foreground',
                  )}
                >
                  {msg.isStreaming && !msg.content ? (
                    <TypingIndicator />
                  ) : isUser ? (
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  ) : (
                    <MessageContent content={msg.content} streaming={msg.isStreaming} />
                  )}
                </div>
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>

        {/* ---- Input area ---- */}
        <div className="shrink-0 border-t border-border bg-card p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="输入消息…"
              disabled={isLoading}
              rows={1}
              className={cn(
                'flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm',
                'ring-offset-background placeholder:text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
              )}
            />
            <Button
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl"
              disabled={!input.trim() || isLoading}
              onClick={handleSend}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mt-2 text-center text-[0.6875rem] text-muted-foreground/60">
            AI 回复仅供参考，请核实重要信息
          </p>
        </div>
      </aside>
    </>
  );
}
