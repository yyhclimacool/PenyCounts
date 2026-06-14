import { useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, Download, Loader2, FileText, RefreshCw } from 'lucide-react';
import { streamReport, type ReportParams } from '@/services/ai';
import { useToast } from '@/hooks/useToast';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/utils/cn';

type Period = 'monthly' | 'yearly';

const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="my-2.5 leading-7 first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2.5 list-disc space-y-1 pl-6 first:mt-0 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2.5 list-decimal space-y-1 pl-6 first:mt-0 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-7">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-5 text-xl font-bold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 border-b border-border/60 pb-1 text-lg font-bold first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-4 text-base font-semibold first:mt-0">{children}</h3>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-2.5 rounded-r-md border-l-4 border-primary/40 bg-primary/5 py-1 pl-4 pr-3 opacity-90">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border/60" />,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const text = String(children);
    const isBlock = text.includes('\n') || /language-/.test(className ?? '');
    if (isBlock) {
      return <code className={cn('font-mono', className)}>{children}</code>;
    }
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2.5 overflow-x-auto rounded-md bg-muted p-3 text-sm leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-md border border-border/60">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border/50 px-3 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border/50 px-3 py-1.5">{children}</td>
  ),
};

function buildYearOptions(): number[] {
  const current = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => current - i);
}

const MONTH_LABELS = [
  '1 月', '2 月', '3 月', '4 月', '5 月', '6 月',
  '7 月', '8 月', '9 月', '10 月', '11 月', '12 月',
];

export default function ReportPage() {
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const now = useMemo(() => new Date(), []);

  const [period, setPeriod] = useState<Period>('monthly');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [report, setReport] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [exporting, setExporting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  const yearOptions = useMemo(buildYearOptions, []);

  const periodLabel =
    period === 'monthly' ? `${year} 年 ${month} 月` : `${year} 年度`;

  const handleGenerate = () => {
    if (streaming) {
      abortRef.current?.abort();
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params: ReportParams = {
      period,
      year,
      ...(period === 'monthly' ? { month } : {}),
    };

    setReport('');
    setStreaming(true);
    setHasRun(true);

    void streamReport(
      params,
      {
        onDelta: (chunk) => setReport((prev) => prev + chunk),
        onError: (err) => {
          toast({
            title: '生成失败',
            description: err.message || '请检查 AI 配置后重试',
            variant: 'destructive',
          });
        },
        onDone: () => setStreaming(false),
      },
      controller.signal,
    );
  };

  const handleExport = async () => {
    const node = captureRef.current;
    if (!node || !report) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import('html2canvas-pro');
      const canvas = await html2canvas(node, {
        backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
        scale: Math.min(2, window.devicePixelRatio || 1.5),
        useCORS: true,
      });
      const link = document.createElement('a');
      const suffix =
        period === 'monthly' ? `${year}-${String(month).padStart(2, '0')}` : `${year}`;
      link.download = `财务报告-${suffix}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      toast({
        title: '导出失败',
        description: err instanceof Error ? err.message : '生成图片时出错',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Sparkles className="size-5 text-primary" />
          AI 财务报告
        </h1>
        <p className="text-sm text-muted-foreground">
          让 AI 帮你解读收支数据，生成可分享的财务分析报告。
        </p>
      </div>

      {/* Controls */}
      <div className="glass flex flex-wrap items-end gap-3 rounded-xl p-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">周期</span>
          <Select
            value={period}
            onValueChange={(v) => setPeriod(v as Period)}
            disabled={streaming}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">月度</SelectItem>
              <SelectItem value="yearly">年度</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">年份</span>
          <Select
            value={String(year)}
            onValueChange={(v) => setYear(Number(v))}
            disabled={streaming}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y} 年
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {period === 'monthly' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">月份</span>
            <Select
              value={String(month)}
              onValueChange={(v) => setMonth(Number(v))}
              disabled={streaming}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_LABELS.map((label, i) => (
                  <SelectItem key={i} value={String(i + 1)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button onClick={handleGenerate} className="gap-1.5">
            {streaming ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                生成中…
              </>
            ) : hasRun ? (
              <>
                <RefreshCw className="size-4" />
                重新生成
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                生成报告
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={!report || streaming || exporting}
            className="gap-1.5"
          >
            {exporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            导出长图
          </Button>
        </div>
      </div>

      {/* Report body */}
      {!hasRun ? (
        <EmptyState
          icon={FileText}
          title="还没有生成报告"
          description="选择周期后点击「生成报告」，AI 将分析你的收支并实时输出。"
          className="py-20"
        />
      ) : (
        <div
          ref={captureRef}
          className="rounded-xl border border-border/60 bg-card p-6 sm:p-8"
        >
          {/* Capture header (branding for the exported image) */}
          <div className="mb-5 flex items-center justify-between border-b border-border/60 pb-4">
            <div>
              <p className="text-lg font-bold">{periodLabel} 财务报告</p>
              <p className="text-xs text-muted-foreground">
                {user?.nickname || user?.username
                  ? `${user.nickname || user.username} · `
                  : ''}
                由 PenyCounts AI 生成
              </p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
              <Sparkles className="size-5 text-primary" />
            </div>
          </div>

          {report ? (
            <div className="text-sm text-foreground/90">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {report}
              </ReactMarkdown>
              {streaming && (
                <span className="ml-0.5 inline-block h-[1.1em] w-[2px] animate-pulse bg-current align-middle" />
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在分析数据…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
