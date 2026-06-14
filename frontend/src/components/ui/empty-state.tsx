import type { ComponentType } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/utils/cn';

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Friendly empty placeholder with a soft gradient icon badge — replaces bare
 * "暂无数据" text to give empty screens more polish.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title = '暂无数据',
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center animate-fade-in',
        className,
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary/80 ring-1 ring-primary/10">
        <Icon className="size-7" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="max-w-[280px] text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
