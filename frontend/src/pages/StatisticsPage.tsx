import { useState, useEffect, useMemo } from 'react';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  BarChart3,
  CalendarDays,
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
import { useDataStore } from '@/stores/dataStore';
import type {
  MonthlyTrend,
  CategoryBreakdown,
  MemberBreakdown,
  SocialSummary,
  DailyTrend,
  YearlyTrend,
} from '@/types';
import { formatCurrency } from '@/utils/format';
import { cn } from '@/utils/cn';


const INCOME_COLOR = '#10B981';
const EXPENSE_COLOR = '#EF4444';

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
  const currentYear = dayjs().year();
  const currentMonth = dayjs().month() + 1;
  const transactionsRev = useDataStore((s) => s.transactionsRev);

  const [year, setYear] = useState(currentYear);
  const [viewType, setViewType] = useState<'all' | 'expense' | 'income'>('all');
  const [monthlyData, setMonthlyData] = useState<MonthlyTrend[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(true);

  const [selectedMonth, setSelectedMonth] = useState(String(currentMonth));
  const [dailyData, setDailyData] = useState<DailyTrend[]>([]);
  const [dailyLoading, setDailyLoading] = useState(true);

  const [yearlyData, setYearlyData] = useState<YearlyTrend[]>([]);
  const [yearlyLoading, setYearlyLoading] = useState(true);

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

  const totalIncome = MONTHS.reduce((s, m) => {
    const row = monthlyData.find((t) => t.month === m);
    return s + (parseFloat(row?.income ?? '0') || 0);
  }, 0);
  const totalExpense = MONTHS.reduce((s, m) => {
    const row = monthlyData.find((t) => t.month === m);
    return s + (parseFloat(row?.expense ?? '0') || 0);
  }, 0);
  const savingsRate = totalIncome > 0
    ? ((totalIncome - totalExpense) / totalIncome) * 100
    : 0;

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

  const monthlyBarOption = useMemo((): echarts.EChartsCoreOption => {
    const series: any[] = [];
    if (showIncome) {
      series.push({
        name: '收入',
        type: 'bar',
        data: monthlyChartData.map((d) => d.income),
        itemStyle: { color: INCOME_COLOR, borderRadius: [4, 4, 0, 0] },
        barGap: '20%',
      });
    }
    if (showExpense) {
      series.push({
        name: '支出',
        type: 'bar',
        data: monthlyChartData.map((d) => d.expense),
        itemStyle: { color: EXPENSE_COLOR, borderRadius: [4, 4, 0, 0] },
        barGap: '20%',
      });
    }
    return {
      tooltip: { trigger: 'axis', ...TOOLTIP_STYLE, formatter: tooltipFormatter },
      legend: { bottom: 0, textStyle: { fontSize: 12 } },
      grid: { left: 60, right: 16, top: 16, bottom: 36 },
      xAxis: {
        type: 'category',
        data: MONTHS.map((m) => `${m}月`),
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
  }, [monthlyChartData, showIncome, showExpense]);

  const dailyAreaOption = useMemo((): echarts.EChartsCoreOption => {
    const series: any[] = [];
    if (showExpense) {
      series.push({
        name: '支出',
        type: 'line',
        data: dailyChartData.map((d) => d.expense),
        smooth: false,
        symbol: 'none',
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
        symbol: 'none',
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-income/10 rounded-lg">
                      <TrendingUp className="size-4 text-income" />
                    </div>
                    <span className="text-sm text-muted-foreground">年度总收入</span>
                  </div>
                  <p className="text-2xl font-bold text-income tabular-nums">
                    {formatCurrency(totalIncome, 'CNY')}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-expense/10 rounded-lg">
                      <TrendingDown className="size-4 text-expense" />
                    </div>
                    <span className="text-sm text-muted-foreground">年度总支出</span>
                  </div>
                  <p className="text-2xl font-bold text-expense tabular-nums">
                    {formatCurrency(totalExpense, 'CNY')}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <PiggyBank className="size-4 text-primary" />
                    </div>
                    <span className="text-sm text-muted-foreground">储蓄率</span>
                  </div>
                  <p className={cn(
                    'text-2xl font-bold tabular-nums',
                    savingsRate >= 0 ? 'text-primary' : 'text-expense',
                  )}>
                    {savingsRate.toFixed(1)}%
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
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
              />
            </CardContent>
          </Card>
        )}
      </div>
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
  const [loading, setLoading] = useState(true);
  const transactionsRev = useDataStore((s) => s.transactionsRev);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    statsService
      .categoryBreakdown({
        year,
        type,
        ...(month !== 'all' && { month: Number(month) }),
      })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData([]))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [year, month, type, transactionsRev]);

  const sorted = [...data].sort(
    (a, b) => parseFloat(b.total) - parseFloat(a.total),
  );
  const pieData = sorted.map((d) => ({
    name: d.category_name,
    value: parseFloat(d.total) || 0,
    icon: d.icon,
    percentage: d.percentage,
  }));

  const barData = sorted.map((d) => ({
    name: `${d.icon} ${d.category_name}`,
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
              />
            </CardContent>
          </Card>
        </>
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    statsService
      .socialSummary({ year })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData([]))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [year, transactionsRev]);

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
    if (showGiven) {
      series.push({
        name: '送出',
        type: 'bar',
        data: chartData.map((d) => d.given),
        itemStyle: { color: EXPENSE_COLOR, borderRadius: [4, 4, 0, 0] },
      });
    }
    if (showReceived) {
      series.push({
        name: '收到',
        type: 'bar',
        data: chartData.map((d) => d.received),
        itemStyle: { color: INCOME_COLOR, borderRadius: [4, 4, 0, 0] },
      });
    }
    return {
      tooltip: { trigger: 'axis', ...TOOLTIP_STYLE, formatter: tooltipFormatter },
      legend: { bottom: 0, textStyle: { fontSize: 12 } },
      grid: { left: 60, right: 16, top: 16, bottom: 36 },
      xAxis: {
        type: 'category',
        data: chartData.map((d) => d.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 12,
          interval: 0,
          rotate: chartData.length > 6 ? 35 : 0,
        },
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
