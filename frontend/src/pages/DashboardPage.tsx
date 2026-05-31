import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Plus,
  ArrowRight,
  MapPin,
  ReceiptText,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Loader2,
  CalendarDays,
  HeartPulse,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import * as statsService from '@/services/stats';
import * as transactionsService from '@/services/transactions';
import * as categoriesService from '@/services/categories';
import { useDataStore } from '@/stores/dataStore';
import type { MonthlyTrend, DailyTrend, DailyHeatmap, YearlyTrend, CategoryBreakdown, Transaction, Category } from '@/types';
import { formatCurrency, formatDate } from '@/utils/format';
import { cn } from '@/utils/cn';
import { TransactionListDialog } from '@/components/TransactionListDialog';


const EXPENSE_COLOR = '#EF4444';
const INCOME_COLOR = '#10B981';
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

export default function DashboardPage() {
  const navigate = useNavigate();
  const now = dayjs();
  const monthlySectionRef = useRef<HTMLDivElement>(null);

  const [year, setYear] = useState(now.year());
  const [month, setMonth] = useState(now.month() + 1);

  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<MonthlyTrend[]>([]);
  const [dailyData, setDailyData] = useState<DailyTrend[]>([]);
  const [categoryData, setCategoryData] = useState<CategoryBreakdown[]>([]);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [heatmapData, setHeatmapData] = useState<DailyHeatmap[]>([]);
  const [yearlyData, setYearlyData] = useState<YearlyTrend[]>([]);
  const [heatmapType, setHeatmapType] = useState<'expense' | 'income'>('expense');
  const [clickedDate, setClickedDate] = useState<string | null>(null);
  const [clickedCategory, setClickedCategory] = useState<{ id: string; name: string } | null>(null);
  const transactionsRev = useDataStore((s) => s.transactionsRev);
  const categoriesRev = useDataStore((s) => s.categoriesRev);

  // Yearly data
  useEffect(() => {
    setLoading(true);
    Promise.all([
      statsService.monthlyTrend({ year }),
      statsService.dailyHeatmap({ year }),
      statsService.yearlyTrend(),
    ])
      .then(([trendData, heatmap, yearly]) => {
        setTrend(trendData);
        setHeatmapData(heatmap);
        setYearlyData(yearly);
      })
      .finally(() => setLoading(false));
  }, [year, transactionsRev]);

  // Monthly data
  useEffect(() => {
    Promise.all([
      statsService.dailyTrend({ year, month }),
      statsService.categoryBreakdown({ year, month, type: 'expense' }),
      transactionsService.list({ per_page: 5 }),
      categoriesService.getAll(),
    ]).then(([daily, cats, txData, allCats]) => {
      setDailyData(daily);
      setCategoryData(cats);
      setRecentTx(txData.data);
      setCategories(allCats);
    });
  }, [year, month, transactionsRev, categoriesRev]);

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

  // --- Yearly computations ---
  const currentYearData = yearlyData.find((y) => y.year === year);
  const yearIncome = parseFloat(currentYearData?.income ?? '0');
  const yearExpense = parseFloat(currentYearData?.expense ?? '0');
  const yearNet = yearIncome - yearExpense;

  const prevYearData = yearlyData.find((y) => y.year === year - 1);
  const prevYearExpense = parseFloat(prevYearData?.expense ?? '0');
  const yearExpenseChange = prevYearExpense > 0
    ? ((yearExpense - prevYearExpense) / prevYearExpense) * 100
    : null;

  const savingsRate = yearIncome > 0
    ? Math.max(0, Math.min(1, (yearIncome - yearExpense) / yearIncome))
    : 0;

  const monthlyChartData = useMemo(() => {
    const map = new Map(trend.map((t) => [t.month, t]));
    return MONTHS.map((m) => {
      const d = map.get(m);
      return {
        month: m,
        income: parseFloat(d?.income ?? '0'),
        expense: parseFloat(d?.expense ?? '0'),
      };
    });
  }, [trend]);

  // --- Monthly computations ---
  const currentMonthData = trend.find((t) => t.month === month);
  const totalIncome = parseFloat(currentMonthData?.income ?? '0');
  const totalExpense = parseFloat(currentMonthData?.expense ?? '0');
  const net = totalIncome - totalExpense;

  const prevMonthData = trend.find((t) => t.month === month - 1);
  const prevExpense = parseFloat(prevMonthData?.expense ?? '0');
  const expenseChange = prevExpense > 0
    ? ((totalExpense - prevExpense) / prevExpense) * 100
    : null;

  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyChartData = useMemo(() => {
    const map = new Map(dailyData.map((d) => [d.day, d]));
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const d = map.get(day);
      return {
        day,
        income: parseFloat(d?.income ?? '0'),
        expense: parseFloat(d?.expense ?? '0'),
      };
    });
  }, [dailyData, daysInMonth]);

  const pieData = useMemo(() => {
    return [...categoryData]
      .sort((a, b) => parseFloat(b.total) - parseFloat(a.total))
      .map((d) => ({
        id: d.category_id,
        name: d.category_name,
        value: parseFloat(d.total) || 0,
        icon: d.icon,
        percentage: d.percentage,
      }));
  }, [categoryData]);

  // --- Charts ---
  const monthlyBarOption = useMemo((): echarts.EChartsCoreOption => ({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', crossStyle: { color: '#999' } },
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: '#e5e7eb',
      textStyle: { color: '#1f2937', fontSize: 12 },
      formatter: (params: any) => {
        const items = Array.isArray(params) ? params : [params];
        let html = `<div style="font-weight:500;margin-bottom:4px">${items[0]?.axisValue}</div>`;
        items.forEach((item: any) => {
          html += `<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color}"></span><span style="color:#6b7280">${item.seriesName}:</span><span style="font-weight:500">${formatCurrency(item.value, 'CNY')}</span></div>`;
        });
        return html;
      },
    },
    legend: { data: ['收入', '支出', '结余'], bottom: 0, textStyle: { fontSize: 12 } },
    grid: { left: 50, right: 50, top: 24, bottom: 36 },
    xAxis: {
      type: 'category',
      data: MONTHS.map((m) => `${m}月`),
      axisPointer: { type: 'shadow' },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 11 },
    },
    yAxis: [
      {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, formatter: formatYAxis },
        splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
      },
      {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 11, formatter: formatYAxis },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '收入',
        type: 'bar',
        data: monthlyChartData.map((d) => d.income),
        itemStyle: { color: INCOME_COLOR, borderRadius: [4, 4, 0, 0] },
        barGap: '20%',
      },
      {
        name: '支出',
        type: 'bar',
        data: monthlyChartData.map((d) => d.expense),
        itemStyle: { color: EXPENSE_COLOR, borderRadius: [4, 4, 0, 0] },
        barGap: '20%',
      },
      {
        name: '结余',
        type: 'line',
        yAxisIndex: 1,
        data: monthlyChartData.map((d) => d.income - d.expense),
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2 },
        itemStyle: { color: BALANCE_COLOR },
      },
    ],
  }), [monthlyChartData]);

  const areaChartOption = useMemo((): echarts.EChartsCoreOption => ({
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: '#e5e7eb',
      textStyle: { color: '#1f2937', fontSize: 12 },
      formatter: (params: any) => {
        const items = Array.isArray(params) ? params : [params];
        let html = `<div style="font-weight:500;margin-bottom:4px">${month}月${items[0]?.axisValue}日</div>`;
        items.forEach((item: any) => {
          html += `<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color}"></span><span style="color:#6b7280">${item.seriesName}:</span><span style="font-weight:500">${formatCurrency(item.value, 'CNY')}</span></div>`;
        });
        return html;
      },
    },
    grid: { left: 50, right: 16, top: 16, bottom: 32 },
    xAxis: {
      type: 'category',
      data: dailyChartData.map((d) => `${d.day}日`),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 11, interval: Math.floor(daysInMonth / 8) },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 11, formatter: formatYAxis },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.3 } },
    },
    series: [
      {
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
      },
      {
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
      },
    ],
  }), [dailyChartData, month, daysInMonth]);

  const pieChartOption = useMemo((): echarts.EChartsCoreOption => ({
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
      inRange: {
        color: colors,
      },
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
      axisTick: {
        length: 12,
        lineStyle: { color: 'auto', width: 2 },
      },
      splitLine: {
        length: 20,
        lineStyle: { color: 'auto', width: 5 },
      },
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
      title: {
        offsetCenter: [0, '-10%'],
        fontSize: 14,
      },
      detail: {
        fontSize: 24,
        offsetCenter: [0, '-35%'],
        valueAnimation: true,
        formatter: (value: number) => Math.round(value * 100) + '%',
        color: 'inherit',
      },
      data: [{
        value: savingsRate,
        name: '储蓄率',
      }],
    }],
  }), [savingsRate]);

  // --- Navigation ---
  function yearPrev() { setYear(year - 1); }
  function yearNext() {
    if (year >= now.year()) return;
    setYear(year + 1);
  }

  function monthPrev() {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  }
  function monthNext() {
    if (year === now.year() && month >= now.month() + 1) return;
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  }

  const isCurrentYear = year === now.year();
  const isCurrentMonth = year === now.year() && month === now.month() + 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-5xl mx-auto relative min-h-screen pb-24">

      {/* ==================== 年度概览 ==================== */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">年度概览</h1>
        <div className="inline-flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={yearPrev}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-base font-semibold w-20 text-center tabular-nums">
            {year}年
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={yearNext}
            disabled={isCurrentYear}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Yearly Summary Cards */}
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

      {/* Monthly Trend Bar+Line Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            每月收支趋势
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {monthlyChartData.every((d) => d.income === 0 && d.expense === 0) ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <BarChart3 className="size-10 mb-2 opacity-30" />
              <p className="text-sm">暂无数据</p>
            </div>
          ) : (
            <ReactECharts
              option={monthlyBarOption}
              style={{ height: 280 }}
              notMerge
              onEvents={{
                click: (params: any) => {
                  const m = params.dataIndex + 1;
                  if (m >= 1 && m <= 12) {
                    setMonth(m);
                    monthlySectionRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }
                },
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Calendar Heatmap */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            年度{heatmapType === 'expense' ? '支出' : '收入'}热力图
          </CardTitle>
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
        </CardHeader>
        <CardContent>
          {heatmapChartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <BarChart3 className="size-10 mb-2 opacity-30" />
              <p className="text-sm">暂无数据</p>
            </div>
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

      {/* Financial Health Gauge */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <HeartPulse className="size-4 text-primary" />
            财务健康度
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ReactECharts
            option={gaugeOption}
            style={{ height: 220 }}
            notMerge
          />
        </CardContent>
      </Card>

      {/* ==================== 分割线 ==================== */}
      <hr className="border-border" />

      {/* ==================== 月度概览 ==================== */}
      <div ref={monthlySectionRef} className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">月度概览</h1>
        <div className="inline-flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={monthPrev}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-base font-semibold w-16 text-center tabular-nums">
            {month}月
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={monthNext}
            disabled={isCurrentMonth}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Monthly Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="p-2 bg-income/10 rounded-lg">
                <TrendingUp className="size-4 text-income" />
              </div>
              <span className="text-xs text-muted-foreground">收入</span>
            </div>
            <p className="text-2xl font-bold text-income tracking-tight tabular-nums">
              {formatCurrency(totalIncome, 'CNY')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="p-2 bg-expense/10 rounded-lg">
                <TrendingDown className="size-4 text-expense" />
              </div>
              <span className="text-xs text-muted-foreground">支出</span>
            </div>
            <p className="text-2xl font-bold text-expense tracking-tight tabular-nums">
              {formatCurrency(totalExpense, 'CNY')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Wallet className="size-4 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground">结余</span>
            </div>
            <p className={cn(
              'text-2xl font-bold tracking-tight tabular-nums',
              net >= 0 ? 'text-primary' : 'text-expense',
            )}>
              {net >= 0 ? '+' : ''}{formatCurrency(net, 'CNY')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <BarChart3 className="size-4 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground">月度环比</span>
            </div>
            {expenseChange !== null ? (
              <p className={cn(
                'text-2xl font-bold tracking-tight tabular-nums',
                expenseChange <= 0 ? 'text-income' : 'text-expense',
              )}>
                {expenseChange > 0 ? '↑' : '↓'}{Math.abs(expenseChange).toFixed(1)}%
              </p>
            ) : (
              <p className="text-lg text-muted-foreground">&mdash;</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">支出环比上月</p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Trend Area Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            日支出趋势
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {dailyChartData.every((d) => d.income === 0 && d.expense === 0) ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <BarChart3 className="size-10 mb-2 opacity-30" />
              <p className="text-sm">暂无数据</p>
            </div>
          ) : (
            <ReactECharts
              option={areaChartOption}
              style={{ height: 240 }}
              notMerge
              onEvents={{
                click: (params: any) => {
                  const day = dailyChartData[params.dataIndex]?.day;
                  if (day != null) {
                    const date = dayjs(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`).format('YYYY-MM-DD');
                    setClickedDate(date);
                  }
                },
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Bottom Row: Pie Chart + Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Pie Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">支出分类占比</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <BarChart3 className="size-10 mb-2 opacity-30" />
                <p className="text-sm">暂无支出数据</p>
              </div>
            ) : (
              <ReactECharts
                option={pieChartOption}
                style={{ height: 260 }}
                notMerge
                onEvents={{
                  click: (params: any) => {
                    const item = pieData[params.dataIndex];
                    if (item) setClickedCategory({ id: item.id, name: item.name });
                  },
                }}
              />
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">最近交易</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/transactions')}
              className="text-muted-foreground hover:text-foreground"
            >
              查看全部
              <ArrowRight className="size-4 ml-1" />
            </Button>
          </CardHeader>
          <CardContent>
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

      {/* Quick Add FAB */}
      <Button
        size="lg"
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 p-0 z-50"
        onClick={() => navigate('/transactions?add=true')}
      >
        <Plus className="!h-6 !w-6" />
      </Button>

      {clickedDate && (
        <TransactionListDialog
          open={!!clickedDate}
          onOpenChange={(open) => { if (!open) setClickedDate(null); }}
          title={`${dayjs(clickedDate).format('M月D日')} 交易记录`}
          startDate={clickedDate}
          endDate={clickedDate}
        />
      )}

      {clickedCategory && (
        <TransactionListDialog
          open={!!clickedCategory}
          onOpenChange={(open) => { if (!open) setClickedCategory(null); }}
          title={`${clickedCategory.name} · ${year}年${month}月`}
          startDate={`${year}-${String(month).padStart(2, '0')}-01`}
          endDate={`${year}-${String(month).padStart(2, '0')}-${daysInMonth}`}
          categoryId={clickedCategory.id}
          type="expense"
        />
      )}
    </div>
  );
}
