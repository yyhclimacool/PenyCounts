import { useEffect, useState } from 'react';
import {
  TrendingUp,
  Wallet,
  PiggyBank,
  Gauge,
  ArrowUpRight,
  ArrowDownRight,
  PieChart,
  CheckCircle2,
  CalendarClock,
  Sparkles,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react';
import * as insightsService from '@/services/insights';
import { useDataStore } from '@/stores/dataStore';
import { useAuthStore } from '@/stores/authStore';
import { useCountUp } from '@/hooks/useCountUp';
import { formatCurrency } from '@/utils/format';
import { cn } from '@/utils/cn';
import type { InsightCard, InsightKind, InsightsResponse } from '@/types';

const ICON_MAP: Record<string, LucideIcon> = {
  'trending-up': TrendingUp,
  wallet: Wallet,
  'piggy-bank': PiggyBank,
  gauge: Gauge,
  'arrow-up-right': ArrowUpRight,
  'arrow-down-right': ArrowDownRight,
  'pie-chart': PieChart,
  'check-circle': CheckCircle2,
  'calendar-clock': CalendarClock,
  sparkles: Sparkles,
};

const KIND_STYLES: Record<InsightKind, { ring: string; icon: string; bg: string }> = {
  warning: {
    ring: 'ring-expense/20',
    icon: 'text-expense bg-expense/10',
    bg: 'hover:bg-expense/[0.03]',
  },
  success: {
    ring: 'ring-income/20',
    icon: 'text-income bg-income/10',
    bg: 'hover:bg-income/[0.03]',
  },
  info: {
    ring: 'ring-primary/15',
    icon: 'text-primary bg-primary/10',
    bg: 'hover:bg-primary/[0.03]',
  },
  tip: {
    ring: 'ring-amber-500/20',
    icon: 'text-amber-500 bg-amber-500/10',
    bg: 'hover:bg-amber-500/[0.03]',
  },
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function InsightCardItem({ card, delay }: { card: InsightCard; delay: number }) {
  const Icon = ICON_MAP[card.icon] ?? Lightbulb;
  const style = KIND_STYLES[card.kind] ?? KIND_STYLES.info;
  return (
    <div
      className={cn(
        'glass flex items-start gap-3 rounded-xl p-3.5 ring-1 transition-colors animate-slide-up opacity-0 [animation-fill-mode:forwards]',
        style.ring,
        style.bg,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', style.icon)}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug">{card.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{card.body}</p>
      </div>
    </div>
  );
}

function HeadlineAmount({ amount }: { amount: number }) {
  const v = useCountUp(amount);
  return <span className="tabular-nums">{formatCurrency(v, 'CNY')}</span>;
}

export function InsightsHeader() {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const transactionsRev = useDataStore((s) => s.transactionsRev);
  const nickname = useAuthStore((s) => s.user?.nickname);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    insightsService
      .getInsights()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [transactionsRev]);

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-28 animate-pulse rounded-2xl bg-muted/40" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="h-20 animate-pulse rounded-xl bg-muted/30" />
          <div className="h-20 animate-pulse rounded-xl bg-muted/30" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { overview, cards } = data;
  const monthExpense = Number.parseFloat(overview.month_expense) || 0;
  const monthNet = Number.parseFloat(overview.month_net) || 0;
  const projected = Number.parseFloat(overview.projected_expense) || 0;
  const pace = overview.days_in_month > 0 ? (overview.days_elapsed / overview.days_in_month) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Headline overview */}
      <div className="glass relative overflow-hidden rounded-2xl p-5 sm:p-6">
        <div
          className="pointer-events-none absolute -right-8 -top-10 size-40 rounded-full opacity-60 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--primary) 0%, transparent 70%)', opacity: 0.12 }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {greeting()}{nickname ? `，${nickname}` : ''}
          </p>
          <span className="text-xs text-muted-foreground tabular-nums">
            {overview.year} 年 {overview.month} 月
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <p className="text-xs text-muted-foreground">本月支出</p>
            <p className="text-3xl font-bold tracking-tight text-expense">
              <HeadlineAmount amount={monthExpense} />
            </p>
          </div>
          <div className="flex flex-col gap-1 pb-1">
            <span
              className={cn(
                'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                monthNet >= 0 ? 'bg-income/10 text-income' : 'bg-expense/10 text-expense',
              )}
            >
              {monthNet >= 0 ? <PiggyBank className="size-3" /> : <Wallet className="size-3" />}
              结余 {monthNet >= 0 ? '+' : ''}{formatCurrency(monthNet, 'CNY')}
            </span>
            {overview.days_elapsed < overview.days_in_month && projected > 0 ? (
              <span className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground">
                <Gauge className="size-3" />
                预计月底约 {formatCurrency(projected, 'CNY')}
              </span>
            ) : null}
          </div>
        </div>

        {/* Month progress */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>本月已过 {overview.days_elapsed}/{overview.days_in_month} 天</span>
            <span className="tabular-nums">{Math.round(pace)}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-[width] duration-700 ease-out"
              style={{ width: `${Math.min(100, pace)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Insight cards */}
      {cards.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map((card, i) => (
            <InsightCardItem key={card.id} card={card} delay={i * 60} />
          ))}
        </div>
      )}
    </div>
  );
}
