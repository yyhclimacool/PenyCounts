import { X } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/utils/cn';

export function Toaster() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'animate-toast-in rounded-xl border bg-card p-4 shadow-lg flex items-start gap-3',
            toast.variant === 'destructive' &&
              'border-destructive/50 bg-destructive/10',
          )}
        >
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                'text-sm font-semibold',
                toast.variant === 'destructive'
                  ? 'text-destructive'
                  : 'text-card-foreground',
              )}
            >
              {toast.title}
            </p>
            {toast.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {toast.description}
              </p>
            )}
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 rounded-md p-1 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
