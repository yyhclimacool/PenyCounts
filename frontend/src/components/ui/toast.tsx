import * as React from 'react';
import { X } from 'lucide-react';

import { useToast, type Toast as ToastData } from '@/hooks/useToast';
import { cn } from '@/utils/cn';

export interface ToastProps extends ToastData {
  onDismiss: () => void;
  className?: string;
}

export function Toast({ title, description, variant, onDismiss, className }: ToastProps) {
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto relative flex w-full items-center justify-between gap-4 overflow-hidden rounded-lg border p-4 pr-8 shadow-lg transition-all',
        'border-border bg-background text-foreground',
        variant === 'destructive' &&
          'border-destructive/50 bg-destructive text-white',
        variant === 'success' &&
          'border-income/40 bg-income/10 text-foreground',
        className,
      )}
    >
      <div className="grid gap-1">
        <p className="text-sm font-semibold">{title}</p>
        {description ? (
          <p
            className={cn(
              'text-sm opacity-90',
              variant === 'destructive' && 'text-white/90',
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className={cn(
          'absolute right-2 top-2 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring',
          variant === 'destructive' && 'focus:ring-white',
        )}
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  return (
    <div
      className="pointer-events-none fixed bottom-0 right-0 z-[100] flex w-full flex-col gap-2 p-4 sm:max-w-[420px]"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <Toast
          key={t.id}
          {...t}
          onDismiss={() => dismiss(t.id)}
        />
      ))}
    </div>
  );
}
