import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  TrendingUp,
  TrendingDown,
  BarChart3,
  CalendarDays,
  Wallet,
  HeartPulse,
  ArrowRight,
  MapPin,
  ReceiptText,
  Plus,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import * as statsService from '@/services/stats';
import * as transactionsService from '@/services/transactions';
import * as categoriesService from '@/services/categories';
import { useDataStore } from '@/stores/dataStore';
import type {
  MonthlyTrend,
  CategoryBreakdown,
  MemberBreakdown,
  SocialSummary,
  SubcategoryBreakdown,
  DailyTrend,
  YearlyTrend,
  DailyHeatmap,
  Transaction,
  Category,
} from '@/types';
import { formatCurrency, formatDate } from '@/utils/format';
import { cn } from '@/utils/cn';
import { TransactionListDialog } from '@/components/TransactionListDialog';


const INCOME_COLOR = '#10B981';
const EXPENSE_COLOR = '#EF4444';
const BALANCE_COLOR = '#0062FF';

const CATEGORY_PALETTE = [
  '#0062FF', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#06B6D4', '#F97316', '#84CC16', '#14B8A6', '#A855F7',
  '#EF4444', '#3B82F6',
];

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function formatYAxis(value: number): string {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}万`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function tooltipFormatter(params: any): string {
  const items = Array.isArray(params) ? params : [params];
  let html = '';
  if (items[0]?.axisValue != null) {
    html += `<div style="font-weight:500;margin-bottom:4px">${items[0].axisValue}</div>`;
  }
  items.forEach((item: any) => {
    html += `<div style="display:flex;align-items:center;gap:6px;line-height:1.8"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color}"></span><span style="color:#6b7280">${item.seriesName}:</span><span style="font-weight:500">${formatCurrency(item.value, 'CNY')}</span></div>`;
  });
  return html;
}

const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(255,255,255,0.96)',
  borderColor: '#e5e7eb',
  textStyle: { color: '#1f2937', fontSize: 12 },
};

/* ------------------------------------------------------------------ */
/*  Shared                                                             */
/* ------------------------------------------------------------------ */

function YearSelector({
  year,
  onChange,
}: {
  year: number;
  onChange: (y: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => onChange(year - 1)}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="text-base font-semibold w-16 text-center tabular-nums">
        {year}年
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => onChange(year + 1)}
        disabled={year >= dayjs().year()}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

function MonthSelect({
  value,
  onChange,
  allowAll = true,
}: {
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-28 h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value="all">全部月份</SelectItem>}
        {MONTHS.map((m) => (
          <SelectItem key={m} value={String(m)}>
            {m}月
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="size-8 animate-spin text-primary" />
    </div>
  );
}

function EmptyState({ message = '暂无数据' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <BarChart3 className="size-12 mb-3 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function TypeToggle({
  value,
  onChange,
}: {
  value: 'all' | 'expense' | 'income';
  onChange: (v: 'all' | 'expense' | 'income') => void;
}) {
  return (
    <div className="flex rounded-lg border p-0.5">
      <Button
        variant={value === 'all' ? 'default' : 'ghost'}
        size="sm"
        className={cn('h-7 text-xs', value === 'all' && 'bg-primary hover:bg-primary/90')}
        onClick={() => onChange('all')}
      >
        全部
      </Button>
      <Button
        variant={value === 'expense' ? 'default' : 'ghost'}
        size="sm"
        className={cn('h-7 text-xs', value === 'expense' && 'bg-expense hover:bg-expense/90')}
        onClick={() => onChange('expense')}
      >
        支出
      </Button>
      <Button
        variant={value === 'income' ? 'default' : 'ghost'}
        size="sm"
        className={cn('h-7 text-xs', value === 'income' && 'bg-income hover:bg-income/90')}
        onClick={() => onChange('income')}
      >
        收入
      </Button>
    </div>
  );
}

/* ================================================================== */
/*  Tab 1 — Overview / Summary Analysis                                */
/* ================================================================== */

function OverviewTab() {
  const navigate = useNavigate();
  const currentYear = dayjs().year();
  const currentMonth = dayjs().month() + 1;
  const transactionsRev = useDataStore((s) => s.transactionsRev);
  const categoriesRev = useDataStore((s) => s.categoriesRev);

  const [year, setYear] = useState(currentYear);
  const [viewType, setViewType] = useState<'all' | 'expense' | 'income'>('all');
  const [monthlyData, setMonthlyData] = useState<MonthlyTrend[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(true);

  const [selectedMonth, setSelectedMonth] = useState(String(currentMonth));
  const [dailyData, setDailyData] = useState<DailyTrend[]>([]);
  const [dailyLoading, setDailyLoading] = useState(true);

  const [yearlyData, setYearlyData] = useState<YearlyTrend[]>([]);
  const [yearlyLoading, setYearlyLoading] = useState(true);
  const [clickedRange, setClickedRange] = useState<{ start: string; end: string; title: string } | null>(null);

  // Merged-in dashboard widgets: calendar heatmap + recent transactions
  const [heatmapData, setHeatmapData] = useState<DailyHeatmap[]>([]);
  const [heatmapType, setHeatmapType] = useState<'expense' | 'income'>('expense');
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [clickedDate, setClickedDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    statsService
      .dailyHeatmap({ year })
      .then((d) => !cancelled && setHeatmapData(d))
      .catch(() => !cancelled && setHeatmapData([]));
    return () => { cancelled = true; };
  }, [year, transactionsRev]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      transactionsService.list({ per_page: 5 }),
      categoriesService.getAll(),
    ])
      .then(([txData, allCats]) => {
        if (!cancelled) {
          setRecentTx(txData.data);
          setCategories(allCats);
        }
      })
      .catch(() => { if (!cancelled) { setRecentTx([]); setCategories([]); } });
    return () => { cancelled = true; };
  }, [transactionsRev, categoriesRev]);

  useEffect(() => {
    let cancelled = false;
    setMonthlyLoading(true);
    statsService
      .monthlyTrend({ year })
      .then((d) => !cancelled && setMonthlyData(d))
      .catch(() => !cancelled && setMonthlyData([]))
      .finally(() => !cancelled && setMonthlyLoading(false));
    return () => { cancelled = true; };
  }, [year, transactionsRev]);

  useEffect(() => {
    let cancelled = false;
    setDailyLoading(true);
    const m = Number(selectedMonth);
    statsService
      .dailyTrend({ year, month: m })
      .then((d) => !cancelled && setDailyData(d))
      .catch(() => !cancelled && setDailyData([]))
      .finally(() => !cancelled && setDailyLoading(false));
    return () => { cancelled = true; };
  }, [year, selectedMonth, transactionsRev]);

  useEffect(() => {
    let cancelled = false;
    setYearlyLoading(true);
    statsService
      .yearlyTrend()
      .then((d) => !cancelled && setYearlyData(d))
      .catch(() => !cancelled && setYearlyData([]))
      .finally(() => !cancelled && setYearlyLoading(false));
    return () => { cancelled = true; };
  }, [transactionsRev]);

  const showIncome = viewType === 'all' || viewType === 'income';
  const showExpense = viewType === 'all' || viewType === 'expense';

  const monthlyChartData = MONTHS.map((m) => {
    const row = monthlyData.find((t) => t.month === m);
    return {
      month: m,
      income: showIncome ? (parseFloat(row?.income ?? '0') || 0) : 0,
      expense: showExpense ? (parseFloat(row?.expense ?? '0') || 0) : 0,
    };
  });

  const dailyChartData = useMemo(() => {
    const m = Number(selectedMonth);
    const days = daysInMonth(year, m);
    return Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      const row = dailyData.find((d) => d.day === day);
      return {
        day,
        income: showIncome ? (parseFloat(row?.income ?? '0') || 0) : 0,
        expense: showExpense ? (parseFloat(row?.expense ?? '0') || 0) : 0,
      };
    });
  }, [dailyData, year, selectedMonth, showIncome, showExpense]);

  const dailyMonthIncome = dailyChartData.reduce((s, d) => s + d.income, 0);
  const dailyMonthExpense = dailyChartData.reduce((s, d) => s + d.expense, 0);

  const yearlyChartData = yearlyData.map((d) => ({
    year: d.year,
    income: showIncome ? (parseFloat(d.income) || 0) : 0,
    expense: showExpense ? (parseFloat(d.expense) || 0) : 0,
  }));

  // --- Year overview (independent of viewType) ---
  const currentYearData = yearlyData.find((y) => y.year === year);
  const yearIncome = parseFloat(currentYearData?.income ?? '0');
  const yearExpense = parseFloat(currentYearData?.expense ?? '0');
  const yearNet = yearIncome - yearExpense;

  const prevYearData = yearlyData.find((y) => y.year === year - 1);
  const prevYearExpense = parseFloat(prevYearData?.expense ?? '0');
  const yearExpenseChange = prevYearExpense > 0
    ? ((yearExpense - prevYearExpense) / prevYearExpense) * 100
    : null;

  const healthRate = yearIncome > 0
    ? Math.max(0, Math.min(1, (yearIncome - yearExpense) / yearIncome))
    : 0;

  // --- Recent transactions enriched with category info ---
  const enrichedRecentTx = useMemo(() => {
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const subMap = new Map(
      categories.flatMap((c) => (c.subcategories ?? []).map((s) => [s.id, s])),
    );
    return recentTx.map((tx) => ({
      ...tx,
      category: catMap.get(tx.category_id),
      subcategory: tx.subcategory_id ? subMap.get(tx.subcategory_id) : undefined,
    }));
  }, [recentTx, categories]);

  // --- Calendar heatmap ---
  const heatmapChartData = useMemo(() =>
    heatmapData.map((d) => [d.date, parseFloat(d[heatmapType]) || 0] as [string, number]),
  [heatmapData, heatmapType]);

  const heatmapMax = useMemo(() => {
    const vals = heatmapChartData.map(([, v]) => v);
    return vals.length > 0 ? Math.max(...vals) : 1000;
  }, [heatmapChartData]);

  const heatmapOption = useMemo((): echarts.EChartsCoreOption => {
    const colors = heatmapType === 'expense'
      ? ['#ebedf0', '#fecaca', '#f87171', '#dc2626', '#991b1b']
      : ['#ebedf0', '#bbf7d0', '#4ade80', '#16a34a', '#14532d'];
    const label = heatmapType === 'expense' ? '支出' : '收入';
    return {
      tooltip: {
        formatter: (params: any) => {
          const val = params.value?.[1] ?? 0;
          return `${params.value?.[0]}<br/>${label}: ${formatCurrency(val, 'CNY')}`;
        },
      },
      visualMap: {
        min: 0,
        max: heatmapMax || 1000,
        type: 'continuous',
        orient: 'horizontal',
        left: 'center',
        top: 0,
        textStyle: { fontSize: 11 },
        inRange: { color: colors },
      },
      calendar: {
        top: 60,
        left: 30,
        right: 30,
        cellSize: ['auto', 13],
        range: String(year),
        itemStyle: { borderWidth: 0.5 },
        yearLabel: { show: false },
        dayLabel: { fontSize: 10, nameMap: 'ZH' },
        monthLabel: { fontSize: 11, nameMap: 'ZH' },
      },
      series: {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: heatmapChartData,
      },
    };
  }, [heatmapChartData, heatmapMax, heatmapType, year]);

  const gaugeOption = useMemo((): echarts.EChartsCoreOption => ({
    series: [{
      type: 'gauge',
      startAngle: 180,
      endAngle: 0,
      center: ['50%', '75%'],
      radius: '90%',
      min: 0,
      max: 1,
      splitNumber: 8,
      axisLine: {
        lineStyle: {
          width: 6,
          color: [
            [0.25, '#FF6E76'],
            [0.5, '#FDDD60'],
            [0.75, '#58D9F9'],
            [1, '#7CFFB2'],
          ],
        },
      },
      pointer: {
        icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
        length: '12%',
        width: 20,
        offsetCenter: [0, '-60%'],
        itemStyle: { color: 'auto' },
      },
      axisTick: { length: 12, lineStyle: { color: 'auto', width: 2 } },
      splitLine: { length: 20, lineStyle: { color: 'auto', width: 5 } },
      axisLabel: {
        color: '#464646',
        fontSize: 14,
        distance: -40,
        rotate: 'tangential',
        formatter: (value: number) => {
          if (value === 0.875) return '优秀';
          if (value === 0.625) return '良好';
          if (value === 0.375) return '一般';
          if (value === 0.125) return '较差';
          return '';
        },
      },
      title: { offsetCenter: [0, '-10%'], fontSize: 14 },
      detail: {
        fontSize: 24,
        offsetCenter: [0, '-35%'],
        valueAnimation: true,
        formatter: (value: number) => Math.round(value * 100) + '%',
        color: 'inherit',
      },
      data: [{ value: healthRate, name: '储蓄率' }],
    }],
  }), [healthRate]);

  const monthlyBarOption = useMemo((): echarts.EChartsCoreOption => {
    const series: any[] = [];
    const legendData: string[] = [];
    if (showIncome) {
      legendData.push('收入');
      series.push({
        name: '收入',
        type: 'bar',
        data: monthlyChartData.map((d) => d.income),
        itemStyle: { color: INCOME_COLOR, borderRadius: [4, 4, 0, 0] },
        barGap: '20%',
      });
    }
    if (showExpense) {
      legendData.push('支出');
      series.push({
        name: '支出',
        type: 'bar',
        data: monthlyChartData.map((d) => d.expense),
        itemStyle: { color: EXPENSE_COLOR, borderRadius: [4, 4, 0, 0] },
        barGap: '20%',
      });
    }
    if (showIncome && showExpense) {
      legendData.push('结余');
      series.push({
        name: '结余',
        type: 'line',
        yAxisIndex: 1,
        data: monthlyChartData.map((d) => d.income - d.expense),
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2 },
        itemStyle: { color: '#0062FF' },
      });
    }
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: '#999' } },
        ...TOOLTIP_STYLE,
        formatter: tooltipFormatter,
      },
      toolbox: {
        right: 8,
        top: 4,
        itemGap: 10,
        feature: {
          dataView: { show: true, readOnly: false },
          magicType: { show: true, type: ['line', 'bar'] },
          restore: { show: true },
          saveAsImage: { show: true },
        },
      },
      legend: { data: legendData, bottom: 0, textStyle: { fontSize: 12 } },
      grid: { left: 60, right: 60, top: 56, bottom: 36 },
      xAxis: {
        type: 'category',
        data: MONTHS.map((m) => `${m}月`),
        axisPointer: { type: 'shadow' },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 12 },
      },
      yAxis: [
        {
          type: 'value',
          name: '金额',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { fontSize: 12, formatter: formatYAxis },
          splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
        },
        {
          type: 'value',
          name: '结余',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { fontSize: 12, formatter: formatYAxis },
          splitLine: { show: false },
        },
      ],
      series,
    };
  }, [monthlyChartData, showIncome, showExpense]);

  const dailyAreaOption = useMemo((): echarts.EChartsCoreOption => {
    const series: any[] = [];
    if (showExpense) {
      series.push({
        name: '支出',
        type: 'line',
        data: dailyChartData.map((d) => d.expense),
        smooth: false,
        symbol: 'emptyCircle',
        symbolSize: 6,
        lineStyle: { color: EXPENSE_COLOR, width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(239,68,68,0.2)' },
            { offset: 1, color: 'rgba(239,68,68,0)' },
          ]),
        },
        itemStyle: { color: EXPENSE_COLOR },
      });
    }
    if (showIncome) {
      series.push({
        name: '收入',
        type: 'line',
        data: dailyChartData.map((d) => d.income),
        smooth: false,
        symbol: 'emptyCircle',
        symbolSize: 6,
        lineStyle: { color: INCOME_COLOR, width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(16,185,129,0.2)' },
            { offset: 1, color: 'rgba(16,185,129,0)' },
          ]),
        },
        itemStyle: { color: INCOME_COLOR },
      });
    }
    return {
      tooltip: {
        trigger: 'axis',
        ...TOOLTIP_STYLE,
        formatter: (params: any) => {
          const items = Array.isArray(params) ? params : [params];
          let html = `<div style="font-weight:500;margin-bottom:4px">${selectedMonth}月${items[0]?.axisValue}</div>`;
          items.forEach((item: any) => {
            html += `<div style="display:flex;align-items:center;gap:6px;line-height:1.8"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color}"></span><span style="color:#6b7280">${item.seriesName}:</span><span style="font-weight:500">${formatCurrency(item.value, 'CNY')}</span></div>`;
          });
          return html;
        },
      },
      legend: { bottom: 0, textStyle: { fontSize: 12 } },
      grid: { left: 55, right: 16, top: 16, bottom: 36 },
      xAxis: {
        type: 'category',
        data: dailyChartData.map((d) => `${d.day}日`),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, interval: Math.floor(dailyChartData.length / 10) },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, formatter: formatYAxis },
        splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
      },
      series,
    };
  }, [dailyChartData, selectedMonth, showIncome, showExpense]);

  const yearlyLineOption = useMemo((): echarts.EChartsCoreOption => {
    const series: any[] = [];
    if (showIncome) {
      series.push({
        name: '收入',
        type: 'line',
        data: yearlyChartData.map((d) => d.income),
        smooth: false,
        symbolSize: 8,
        lineStyle: { color: INCOME_COLOR, width: 2.5 },
        itemStyle: { color: INCOME_COLOR },
      });
    }
    if (showExpense) {
      series.push({
        name: '支出',
        type: 'line',
        data: yearlyChartData.map((d) => d.expense),
        smooth: false,
        symbolSize: 8,
        lineStyle: { color: EXPENSE_COLOR, width: 2.5 },
        itemStyle: { color: EXPENSE_COLOR },
      });
    }
    return {
      tooltip: { trigger: 'axis', ...TOOLTIP_STYLE, formatter: tooltipFormatter },
      legend: { bottom: 0, textStyle: { fontSize: 12 } },
      grid: { left: 60, right: 16, top: 16, bottom: 36 },
      xAxis: {
        type: 'category',
        data: yearlyChartData.map((d) => `${d.year}`),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 12 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 12, formatter: formatYAxis },
        splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
      },
      series,
    };
  }, [yearlyChartData, showIncome, showExpense]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <YearSelector year={year} onChange={setYear} />
        <TypeToggle value={viewType} onChange={setViewType} />
      </div>

      {/* Year Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="p-2 bg-income/10 rounded-lg">
                <TrendingUp className="size-4 text-income" />
              </div>
              <span className="text-xs text-muted-foreground">年度收入</span>
            </div>
            <p className="text-2xl font-bold text-income tracking-tight tabular-nums">
              {formatCurrency(yearIncome, 'CNY')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="p-2 bg-expense/10 rounded-lg">
                <TrendingDown className="size-4 text-expense" />
              </div>
              <span className="text-xs text-muted-foreground">年度支出</span>
            </div>
            <p className="text-2xl font-bold text-expense tracking-tight tabular-nums">
              {formatCurrency(yearExpense, 'CNY')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Wallet className="size-4 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground">年度结余</span>
            </div>
            <p className={cn(
              'text-2xl font-bold tracking-tight tabular-nums',
              yearNet >= 0 ? 'text-primary' : 'text-expense',
            )}>
              {yearNet >= 0 ? '+' : ''}{formatCurrency(yearNet, 'CNY')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <BarChart3 className="size-4 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground">年度同比</span>
            </div>
            {yearExpenseChange !== null ? (
              <p className={cn(
                'text-2xl font-bold tracking-tight tabular-nums',
                yearExpenseChange <= 0 ? 'text-income' : 'text-expense',
              )}>
                {yearExpenseChange > 0 ? '↑' : '↓'}{Math.abs(yearExpenseChange).toFixed(1)}%
              </p>
            ) : (
              <p className="text-lg text-muted-foreground">&mdash;</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">支出同比上年</p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Trend */}
      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <CalendarDays className="size-4 text-primary" />
          每月趋势
        </h2>

        {monthlyLoading ? (
          <Spinner />
        ) : monthlyData.length === 0 ? (
          <EmptyState message="该年度暂无数据" />
        ) : (
          <>
            <Card>
              <CardContent className="pt-6">
                <ReactECharts
                  option={monthlyBarOption}
                  style={{ height: 320 }}
                  notMerge
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Calendar Heatmap */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            年度{heatmapType === 'expense' ? '支出' : '收入'}热力图
          </h2>
          <div className="inline-flex rounded-lg border p-0.5 text-xs">
            <button
              className={cn(
                'px-2.5 py-1 rounded-md transition-colors',
                heatmapType === 'expense' ? 'bg-expense text-white' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setHeatmapType('expense')}
            >
              支出
            </button>
            <button
              className={cn(
                'px-2.5 py-1 rounded-md transition-colors',
                heatmapType === 'income' ? 'bg-income text-white' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setHeatmapType('income')}
            >
              收入
            </button>
          </div>
        </div>
        <Card>
          <CardContent className="pt-6">
            {heatmapChartData.length === 0 ? (
              <EmptyState message="该年度暂无数据" />
            ) : (
              <ReactECharts
                option={heatmapOption}
                style={{ height: 200 }}
                notMerge
                onEvents={{
                  click: (params: any) => {
                    const date = params.value?.[0];
                    if (date) setClickedDate(date);
                  },
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Financial Health Gauge */}
      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <HeartPulse className="size-4 text-primary" />
          财务健康度
        </h2>
        <Card>
          <CardContent className="pt-6">
            <ReactECharts option={gaugeOption} style={{ height: 220 }} notMerge />
          </CardContent>
        </Card>
      </div>

      {/* Daily Trend */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            日趋势
          </h2>
          <MonthSelect value={selectedMonth} onChange={setSelectedMonth} allowAll={false} />
        </div>

        {dailyLoading ? (
          <Spinner />
        ) : dailyData.length === 0 ? (
          <EmptyState message="该月暂无数据" />
        ) : (
          <>
            <Card>
              <CardContent className="pt-6">
                <ReactECharts
                  option={dailyAreaOption}
                  style={{ height: 280 }}
                  notMerge
                  onEvents={{
                    click: (params: any) => {
                      const day = dailyChartData[params.dataIndex]?.day;
                      if (day != null) {
                        const m = String(selectedMonth).padStart(2, '0');
                        const d = String(day).padStart(2, '0');
                        const date = `${year}-${m}-${d}`;
                        setClickedRange({ start: date, end: date, title: `${selectedMonth}月${day}日 交易记录` });
                      }
                    },
                  }}
                />
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">{selectedMonth}月收入</p>
                  <p className="text-xl font-bold text-income tabular-nums">
                    {formatCurrency(dailyMonthIncome, 'CNY')}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">{selectedMonth}月支出</p>
                  <p className="text-xl font-bold text-expense tabular-nums">
                    {formatCurrency(dailyMonthExpense, 'CNY')}
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>

      {/* Yearly Trend */}
      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <CalendarDays className="size-4 text-primary" />
          年度趋势
        </h2>

        {yearlyLoading ? (
          <Spinner />
        ) : yearlyChartData.length === 0 ? (
          <EmptyState message="暂无年度数据" />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <ReactECharts
                option={yearlyLineOption}
                style={{ height: 300 }}
                notMerge
                onEvents={{
                  click: (params: any) => {
                    const y = yearlyChartData[params.dataIndex]?.year;
                    if (y != null) {
                      setClickedRange({ start: `${y}-01-01`, end: `${y}-12-31`, title: `${y}年 交易记录` });
                    }
                  },
                }}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ReceiptText className="size-4 text-primary" />
            最近交易
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/transactions')}
            className="text-muted-foreground hover:text-foreground"
          >
            查看全部
            <ArrowRight className="size-4 ml-1" />
          </Button>
        </div>
        <Card>
          <CardContent className="pt-6">
            {enrichedRecentTx.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-muted-foreground">
                <ReceiptText className="size-10 mb-2 opacity-40" />
                <p className="text-sm">暂无交易记录</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate('/transactions?add=true')}
                >
                  <Plus className="size-4" />
                  添加第一笔
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {enrichedRecentTx.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => navigate('/transactions')}
                  >
                    <span className="text-lg size-8 flex items-center justify-center rounded-lg bg-muted/60 shrink-0">
                      {tx.category?.icon ?? '📝'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {tx.category?.name ?? '未分类'}
                        {tx.subcategory && (
                          <span className="text-muted-foreground font-normal"> / {tx.subcategory.name}</span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span>{formatDate(tx.date)}</span>
                        {tx.location && (
                          <span className="inline-flex items-center gap-0.5">
                            <MapPin className="size-3" />
                            {tx.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={cn(
                      'text-sm font-semibold tabular-nums whitespace-nowrap',
                      tx.type === 'income' ? 'text-income' : 'text-expense',
                    )}>
                      {tx.type === 'income' ? '+' : '-'}
                      {formatCurrency(tx.amount, tx.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {clickedRange && (
        <TransactionListDialog
          open={!!clickedRange}
          onOpenChange={(open) => { if (!open) setClickedRange(null); }}
          title={clickedRange.title}
          startDate={clickedRange.start}
          endDate={clickedRange.end}
        />
      )}

      {clickedDate && (
        <TransactionListDialog
          open={!!clickedDate}
          onOpenChange={(open) => { if (!open) setClickedDate(null); }}
          title={`${dayjs(clickedDate).format('M月D日')} 交易记录`}
          startDate={clickedDate}
          endDate={clickedDate}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/*  Tab 2 — Category Breakdown                                         */
/* ================================================================== */

function CategoryBreakdownTab() {
  const [year, setYear] = useState(dayjs().year());
  const [month, setMonth] = useState('all');
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [data, setData] = useState<CategoryBreakdown[]>([]);
  const [subData, setSubData] = useState<SubcategoryBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const transactionsRev = useDataStore((s) => s.transactionsRev);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = { year, type, ...(month !== 'all' && { month: Number(month) }) };
    Promise.all([
      statsService.categoryBreakdown(params),
      statsService.subcategoryBreakdown(params),
    ])
      .then(([catData, subcatData]) => {
        if (!cancelled) {
          setData(catData);
          setSubData(subcatData);
        }
      })
      .catch(() => { if (!cancelled) { setData([]); setSubData([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, month, type, transactionsRev]);

  const [clickedCategory, setClickedCategory] = useState<{ id: string; name: string } | null>(null);

  const sorted = [...data].sort(
    (a, b) => parseFloat(b.total) - parseFloat(a.total),
  );
  const pieData = sorted.map((d) => ({
    id: d.category_id,
    name: d.category_name,
    value: parseFloat(d.total) || 0,
    icon: d.icon,
    percentage: d.percentage,
  }));

  const barData = sorted.map((d) => ({
    id: d.category_id,
    name: `${d.icon} ${d.category_name}`,
    rawName: d.category_name,
    value: parseFloat(d.total) || 0,
    percentage: d.percentage,
  }));

  const pieOption = useMemo((): echarts.EChartsCoreOption => ({
    tooltip: {
      trigger: 'item',
      formatter: '{b} : {c} ({d}%)',
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 10,
      top: 20,
      bottom: 20,
    },
    series: [
      {
        type: 'pie',
        radius: '55%',
        center: ['40%', '50%'],
        data: pieData.map((d, i) => ({
          name: d.name,
          value: d.value,
          itemStyle: { color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] },
        })),
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  }), [pieData]);

  const barOption = useMemo((): echarts.EChartsCoreOption => ({
    tooltip: {
      trigger: 'axis',
      ...TOOLTIP_STYLE,
      formatter: tooltipFormatter,
    },
    grid: { left: 110, right: 80, top: 8, bottom: 8 },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 11, formatter: formatYAxis },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
    },
    yAxis: {
      type: 'category',
      data: barData.map((d) => d.name).reverse(),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 12 },
    },
    series: [
      {
        name: '金额',
        type: 'bar',
        data: barData.map((d, i) => ({
          value: d.value,
          itemStyle: { color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] },
        })).reverse(),
        barWidth: 22,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: 'right',
          fontSize: 11,
          color: '#64748b',
          formatter: (params: any) => {
            const idx = barData.length - 1 - params.dataIndex;
            return `${barData[idx]?.percentage.toFixed(1)}%`;
          },
        },
      },
    ],
  }), [barData]);

  const sankeyOption = useMemo((): echarts.EChartsCoreOption => {
    const typeLabel = type === 'expense' ? '总支出' : '总收入';
    const grandTotal = sorted.reduce((s, d) => s + (parseFloat(d.total) || 0), 0);
    if (grandTotal === 0) return {};

    const nodes: { name: string }[] = [{ name: typeLabel }];
    const links: { source: string; target: string; value: number }[] = [];
    const catTotals = new Map<string, number>();

    for (const row of subData) {
      const val = parseFloat(row.total) || 0;
      if (val <= 0) continue;
      catTotals.set(row.category_name, (catTotals.get(row.category_name) || 0) + val);
    }

    for (const [catName] of catTotals) {
      nodes.push({ name: catName });
      links.push({ source: typeLabel, target: catName, value: catTotals.get(catName)! });
    }

    for (const row of subData) {
      const val = parseFloat(row.total) || 0;
      if (val <= 0 || !row.subcategory_name) continue;
      const subName = `${row.subcategory_name}`;
      const uniqueName = nodes.find((n) => n.name === subName)
        ? subName
        : subName;
      if (!nodes.find((n) => n.name === uniqueName)) {
        nodes.push({ name: uniqueName });
      }
      links.push({ source: row.category_name, target: uniqueName, value: val });
    }

    for (const row of subData) {
      const val = parseFloat(row.total) || 0;
      if (val <= 0 || row.subcategory_name) continue;
      const uncat = `${row.category_name}-未细分`;
      if (!nodes.find((n) => n.name === uncat)) {
        nodes.push({ name: uncat });
      }
      links.push({ source: row.category_name, target: uncat, value: val });
    }

    return {
      tooltip: {
        trigger: 'item',
        triggerOn: 'mousemove',
        formatter: (params: any) => {
          if (params.dataType === 'edge') {
            return `${params.data.source} → ${params.data.target}<br/>金额: ${formatCurrency(params.data.value, 'CNY')}`;
          }
          return `${params.name}<br/>金额: ${formatCurrency(params.value, 'CNY')}`;
        },
      },
      series: [
        {
          type: 'sankey',
          data: nodes,
          links,
          emphasis: { focus: 'adjacency' },
          levels: [
            {
              depth: 0,
              itemStyle: { color: type === 'expense' ? EXPENSE_COLOR : INCOME_COLOR },
              lineStyle: { color: 'source', opacity: 0.4 },
            },
            {
              depth: 1,
              lineStyle: { color: 'source', opacity: 0.3 },
            },
            {
              depth: 2,
              lineStyle: { color: 'source', opacity: 0.2 },
            },
          ],
          lineStyle: { curveness: 0.5 },
          label: { fontSize: 12 },
          nodeGap: 12,
        },
      ],
    };
  }, [sorted, subData, type]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <YearSelector year={year} onChange={setYear} />
        <MonthSelect value={month} onChange={setMonth} />
        <div className="flex rounded-lg border p-0.5 ml-auto">
          <Button
            variant={type === 'expense' ? 'default' : 'ghost'}
            size="sm"
            className={cn(
              'h-7 text-xs',
              type === 'expense' && 'bg-expense hover:bg-expense/90',
            )}
            onClick={() => setType('expense')}
          >
            支出
          </Button>
          <Button
            variant={type === 'income' ? 'default' : 'ghost'}
            size="sm"
            className={cn(
              'h-7 text-xs',
              type === 'income' && 'bg-income hover:bg-income/90',
            )}
            onClick={() => setType('income')}
          >
            收入
          </Button>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              <ReactECharts
                option={pieOption}
                style={{ height: 300 }}
                notMerge
                onEvents={{
                  click: (params: any) => {
                    const item = pieData[params.dataIndex];
                    if (item) setClickedCategory({ id: item.id, name: item.name });
                  },
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">分类排名</CardTitle>
            </CardHeader>
            <CardContent>
              <ReactECharts
                option={barOption}
                style={{ height: Math.max(180, barData.length * 44) }}
                notMerge
                onEvents={{
                  click: (params: any) => {
                    const idx = barData.length - 1 - params.dataIndex;
                    const item = barData[idx];
                    if (item) setClickedCategory({ id: item.id, name: item.rawName });
                  },
                }}
              />
            </CardContent>
          </Card>

          {subData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">分类流向</CardTitle>
              </CardHeader>
              <CardContent>
                <ReactECharts
                  option={sankeyOption}
                  style={{ height: Math.max(400, sorted.length * 50) }}
                  notMerge
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {clickedCategory && (
        <TransactionListDialog
          open={!!clickedCategory}
          onOpenChange={(open) => { if (!open) setClickedCategory(null); }}
          title={`${clickedCategory.name} · ${year}年${month !== 'all' ? `${month}月` : ''}`}
          startDate={month !== 'all' ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`}
          endDate={month !== 'all' ? `${year}-${String(month).padStart(2, '0')}-${daysInMonth(year, Number(month))}` : `${year}-12-31`}
          categoryId={clickedCategory.id}
          type={type}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/*  Tab 3 — Member Analysis                                            */
/* ================================================================== */

function MemberAnalysisTab() {
  const [year, setYear] = useState(dayjs().year());
  const [month, setMonth] = useState('all');
  const [viewType, setViewType] = useState<'all' | 'expense' | 'income'>('all');
  const [data, setData] = useState<MemberBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const transactionsRev = useDataStore((s) => s.transactionsRev);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    statsService
      .memberBreakdown({
        year,
        ...(month !== 'all' && { month: Number(month) }),
        ...(viewType !== 'all' && { type: viewType }),
      })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData([]))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [year, month, viewType, transactionsRev]);

  const sorted = [...data].sort(
    (a, b) => parseFloat(b.total) - parseFloat(a.total),
  );
  const grandTotal = sorted.reduce(
    (s, d) => s + (parseFloat(d.total) || 0),
    0,
  );

  const barData = sorted.map((d) => {
    const val = parseFloat(d.total) || 0;
    return {
      name: d.member_name,
      total: val,
      percentage: grandTotal > 0 ? (val / grandTotal) * 100 : 0,
    };
  });

  const barColor = viewType === 'income' ? INCOME_COLOR : viewType === 'expense' ? EXPENSE_COLOR : '#0062FF';

  const barOption = useMemo((): echarts.EChartsCoreOption => {
    const hex = barColor.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    return {
      tooltip: {
        trigger: 'axis',
        ...TOOLTIP_STYLE,
        formatter: tooltipFormatter,
      },
      grid: { left: 80, right: 140, top: 8, bottom: 8 },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, formatter: formatYAxis },
        splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
      },
      yAxis: {
        type: 'category',
        data: barData.map((d) => d.name).reverse(),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 13 },
      },
      series: [
        {
          name: viewType === 'income' ? '收入' : viewType === 'expense' ? '支出' : '金额',
          type: 'bar',
          data: barData.map((d, i) => {
            const opacity = 1 - (i / Math.max(barData.length - 1, 1)) * 0.6;
            return {
              value: d.total,
              itemStyle: { color: `rgba(${r}, ${g}, ${b}, ${opacity})` },
            };
          }).reverse(),
          barWidth: 28,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: 'right',
            fontSize: 11,
            color: '#64748b',
            formatter: (params: any) => {
              const idx = barData.length - 1 - params.dataIndex;
              const d = barData[idx];
              if (!d) return '';
              return `${formatCurrency(d.total, 'CNY')} (${d.percentage.toFixed(1)}%)`;
            },
          },
        },
      ],
    };
  }, [barData, barColor, viewType]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <YearSelector year={year} onChange={setYear} />
          <MonthSelect value={month} onChange={setMonth} />
        </div>
        <TypeToggle value={viewType} onChange={setViewType} />
      </div>

      {loading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <ReactECharts
              option={barOption}
              style={{ height: Math.max(180, barData.length * 52) }}
              notMerge
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Tab 4 — Social Gifts Analysis                                      */
/* ================================================================== */

function SocialGiftsTab() {
  const [year, setYear] = useState(dayjs().year());
  const [viewType, setViewType] = useState<'all' | 'expense' | 'income'>('all');
  const [data, setData] = useState<SocialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const transactionsRev = useDataStore((s) => s.transactionsRev);
  const socialGiftsRev = useDataStore((s) => s.socialGiftsRev);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    statsService
      .socialSummary({ year })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData([]))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [year, transactionsRev, socialGiftsRev]);

  const showGiven = viewType === 'all' || viewType === 'expense';
  const showReceived = viewType === 'all' || viewType === 'income';

  const totalGiven = data.reduce(
    (s, d) => s + (parseFloat(d.given) || 0),
    0,
  );
  const totalReceived = data.reduce(
    (s, d) => s + (parseFloat(d.received) || 0),
    0,
  );
  const netBalance = totalReceived - totalGiven;

  const chartData = data.map((d) => ({
    name: d.person_name,
    given: showGiven ? (parseFloat(d.given) || 0) : 0,
    received: showReceived ? (parseFloat(d.received) || 0) : 0,
  }));

  const socialBarOption = useMemo((): echarts.EChartsCoreOption => {
    const series: any[] = [];
    const legendData: string[] = [];
    if (showGiven) {
      legendData.push('送出');
      series.push({
        name: '送出',
        type: 'bar',
        data: chartData.map((d) => d.given),
        itemStyle: { color: EXPENSE_COLOR, borderRadius: [4, 4, 0, 0] },
      });
    }
    if (showReceived) {
      legendData.push('收到');
      series.push({
        name: '收到',
        type: 'bar',
        data: chartData.map((d) => d.received),
        itemStyle: { color: INCOME_COLOR, borderRadius: [4, 4, 0, 0] },
      });
    }
    if (showGiven && showReceived) {
      legendData.push('净额');
      series.push({
        name: '净额',
        type: 'line',
        yAxisIndex: 1,
        data: chartData.map((d) => d.received - d.given),
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2 },
        itemStyle: { color: '#0062FF' },
      });
    }
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: '#999' } },
        ...TOOLTIP_STYLE,
        formatter: tooltipFormatter,
      },
      toolbox: {
        right: 8,
        top: 4,
        itemGap: 10,
        feature: {
          dataView: { show: true, readOnly: false },
          magicType: { show: true, type: ['line', 'bar'] },
          restore: { show: true },
          saveAsImage: { show: true },
        },
      },
      legend: { data: legendData, bottom: 0, textStyle: { fontSize: 12 } },
      grid: { left: 60, right: 60, top: 56, bottom: 36 },
      xAxis: {
        type: 'category',
        data: chartData.map((d) => d.name),
        axisPointer: { type: 'shadow' },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 12,
          interval: 0,
          rotate: chartData.length > 6 ? 35 : 0,
        },
      },
      yAxis: [
        {
          type: 'value',
          name: '金额',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { fontSize: 11, formatter: formatYAxis },
          splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
        },
        {
          type: 'value',
          name: '净额',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { fontSize: 11, formatter: formatYAxis },
          splitLine: { show: false },
        },
      ],
      series,
    };
  }, [chartData, showGiven, showReceived]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <YearSelector year={year} onChange={setYear} />
        <TypeToggle value={viewType} onChange={setViewType} />
      </div>

      {loading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground mb-1">总送出</p>
                <p className="text-2xl font-bold text-expense tabular-nums">
                  {formatCurrency(totalGiven, 'CNY')}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground mb-1">总收到</p>
                <p className="text-2xl font-bold text-income tabular-nums">
                  {formatCurrency(totalReceived, 'CNY')}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground mb-1">净余额</p>
                <p
                  className={cn(
                    'text-2xl font-bold tabular-nums',
                    netBalance >= 0 ? 'text-income' : 'text-expense',
                  )}
                >
                  {netBalance >= 0 ? '+' : ''}
                  {formatCurrency(netBalance, 'CNY')}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="pt-6">
              <ReactECharts
                option={socialBarOption}
                style={{ height: 350 }}
                notMerge
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">明细列表</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2.5 font-medium">姓名</th>
                      {showGiven && <th className="text-right py-2.5 font-medium">送出</th>}
                      {showReceived && <th className="text-right py-2.5 font-medium">收到</th>}
                      <th className="text-right py-2.5 font-medium">净额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row) => {
                      const net = parseFloat(row.net) || 0;
                      return (
                        <tr
                          key={row.person_name}
                          className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                        >
                          <td className="py-2.5 font-medium">
                            {row.person_name}
                          </td>
                          {showGiven && (
                            <td className="py-2.5 text-right text-expense tabular-nums">
                              {formatCurrency(row.given, 'CNY')}
                            </td>
                          )}
                          {showReceived && (
                            <td className="py-2.5 text-right text-income tabular-nums">
                              {formatCurrency(row.received, 'CNY')}
                            </td>
                          )}
                          <td
                            className={cn(
                              'py-2.5 text-right font-medium tabular-nums',
                              net >= 0 ? 'text-income' : 'text-expense',
                            )}
                          >
                            {net >= 0 ? '+' : ''}
                            {formatCurrency(row.net, 'CNY')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Main Page                                                          */
/* ================================================================== */

export default function StatisticsPage() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight">统计分析</h1>

      <Tabs defaultValue="overview">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="overview" className="text-xs sm:text-sm">
            汇总分析
          </TabsTrigger>
          <TabsTrigger value="category" className="text-xs sm:text-sm">
            分类分析
          </TabsTrigger>
          <TabsTrigger value="member" className="text-xs sm:text-sm">
            人员分析
          </TabsTrigger>
          <TabsTrigger value="social" className="text-xs sm:text-sm">
            人情分析
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="category">
          <CategoryBreakdownTab />
        </TabsContent>
        <TabsContent value="member">
          <MemberAnalysisTab />
        </TabsContent>
        <TabsContent value="social">
          <SocialGiftsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
