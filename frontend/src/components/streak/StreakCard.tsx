import { useEffect, useMemo, useState } from 'react';
import { Flame, Trophy, CalendarDays, Receipt, Lock } from 'lucide-react';
import { getStreak } from '@/services/streak';
import { useDataStore } from '@/stores/dataStore';
import { useCountUp } from '@/hooks/useCountUp';
import { cn } from '@/utils/cn';
import type { Achievement, DayCount, StreakResponse } from '@/types';

function intensityClass(count: number): string {
  if (count <= 0) return 'bg-muted/60';
  if (count <= 2) return 'bg-primary/30';
  if (count <= 4) return 'bg-primary/55';
  if (count <= 6) return 'bg-primary/75';
  return 'bg-primary';
}

interface HeatCell {
  key: string;
  day?: DayCount;
}

function buildCells(daily: DayCount[]): HeatCell[] {
  if (daily.length === 0) return [];
  // Pad the start so the first column begins on the correct weekday (Sun=0).
  const first = new Date(`${daily[0].date}T00:00:00`);
  const pad = first.getDay();
  const cells: HeatCell[] = [];
  for (let i = 0; i < pad; i++) {
    cells.push({ key: `pad-${i}` });
  }
  for (const day of daily) {
    cells.push({ key: day.date, day });
  }
  return cells;
}

function StatBlock({
  icon: Icon,
  value,
  suffix,
  label,
  accent,
}: {
  icon: typeof Flame;
  value: number;
  suffix?: string;
  label: string;
  accent?: string;
}) {
  const animated = useCountUp(value);
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/40 px-2 py-3 text-center">
      <Icon className={cn('size-4', accent ?? 'text-primary')} />
      <div className="text-lg font-bold leading-none">
        {animated}
        {suffix ? <span className="ml-0.5 text-xs font-medium">{suffix}</span> : null}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Badge({ a }: { a: Achievement }) {
  return (
    <div
      title={a.description}
      className={cn(
        'relative flex flex-col items-center gap-1 rounded-xl border p-2.5 text-center transition',
        a.unlocked
          ? 'border-primary/30 bg-primary/5'
          : 'border-border/50 bg-muted/30',
      )}
    >
      <div
        className={cn(
          'flex size-9 items-center justify-center rounded-full text-lg',
          a.unlocked ? 'bg-primary/10' : 'bg-muted grayscale',
        )}
      >
        {a.unlocked ? (
          <span>{a.icon}</span>
        ) : (
          <Lock className="size-4 text-muted-foreground" />
        )}
      </div>
      <div
        className={cn(
          'text-[11px] font-medium leading-tight',
          a.unlocked ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {a.title}
      </div>
      {!a.unlocked && a.progress > 0 && (
        <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary/50 transition-[width] duration-500"
            style={{ width: `${Math.round(a.progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function StreakCard() {
  const [data, setData] = useState<StreakResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const transactionsRev = useDataStore((s) => s.transactionsRev);

  useEffect(() => {
    let active = true;
    getStreak()
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        /* silent — section is non-critical */
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [transactionsRev]);

  const cells = useMemo(() => buildCells(data?.daily ?? []), [data?.daily]);

  if (loading) {
    return <div className="glass h-44 animate-pulse rounded-2xl" />;
  }
  if (!data) return null;

  return (
    <div className="glass flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Flame className="size-4 text-orange-500" />
          记账打卡
        </h2>
        {data.today_logged ? (
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            今日已打卡
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            今日未打卡
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <StatBlock
          icon={Flame}
          value={data.current_streak}
          suffix="天"
          label="当前连续"
          accent="text-orange-500"
        />
        <StatBlock
          icon={Trophy}
          value={data.longest_streak}
          suffix="天"
          label="最长连续"
          accent="text-amber-500"
        />
        <StatBlock
          icon={CalendarDays}
          value={data.total_active_days}
          suffix="天"
          label="累计天数"
        />
        <StatBlock
          icon={Receipt}
          value={data.total_transactions}
          suffix="笔"
          label="累计笔数"
        />
      </div>

      {/* Heatmap */}
      <div className="overflow-x-auto">
        <div
          className="grid w-max grid-flow-col grid-rows-7 gap-[3px]"
          role="img"
          aria-label="近半年记账热力图"
        >
          {cells.map((cell) =>
            cell.day ? (
              <div
                key={cell.key}
                title={`${cell.day.date} · ${cell.day.count} 笔`}
                className={cn(
                  'size-[11px] rounded-[3px]',
                  intensityClass(cell.day.count),
                )}
              />
            ) : (
              <div key={cell.key} className="size-[11px] rounded-[3px]" />
            ),
          )}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
          <span>少</span>
          <span className="size-[10px] rounded-[2px] bg-muted/60" />
          <span className="size-[10px] rounded-[2px] bg-primary/30" />
          <span className="size-[10px] rounded-[2px] bg-primary/55" />
          <span className="size-[10px] rounded-[2px] bg-primary/75" />
          <span className="size-[10px] rounded-[2px] bg-primary" />
          <span>多</span>
        </div>
      </div>

      {/* Achievements */}
      {data.achievements.length > 0 && (
        <div className="grid grid-cols-4 gap-2 border-t border-border/50 pt-4 sm:grid-cols-7">
          {data.achievements.map((a) => (
            <Badge key={a.id} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}
