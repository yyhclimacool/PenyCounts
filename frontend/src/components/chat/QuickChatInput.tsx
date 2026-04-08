import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';

import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/stores/chatStore';

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);

export function QuickChatInput() {
  const { isOpen, isLoading, setOpen, loadHistory, sendMessage } = useChatStore();
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    setOpen(true);
    await loadHistory();
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      inputRef.current?.blur();
    }
  };

  if (isOpen) return null;

  return (
    <div
      className={cn(
        'fixed bottom-6 left-1/2 z-30 w-[92%] max-w-xl -translate-x-1/2',
        'transition-all duration-300',
        focused ? 'scale-[1.02]' : 'scale-100',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-2xl border bg-background/80 px-4 py-2.5',
          'shadow-lg shadow-black/5 backdrop-blur-xl',
          'transition-all duration-200',
          focused
            ? 'border-primary/40 ring-2 ring-primary/20'
            : 'border-border',
        )}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-primary/60" />

        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="输入消息，让 AI 帮你记账..."
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
        />

        {!input.trim() && (
          <kbd className="hidden shrink-0 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground sm:inline-block">
            {IS_MAC ? '⌘' : 'Ctrl+'}K
          </kbd>
        )}

        {input.trim() && (
          <Button
            size="icon"
            className="h-7 w-7 shrink-0 rounded-lg"
            disabled={isLoading}
            onClick={handleSend}
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
