import { useState, useEffect, useMemo } from 'react';
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
import { useDataStore } from '@/stores/dataStore';
import type { MonthlyTrend, DailyTrend, CategoryBreakdown, Transaction } from '@/types';
import { formatCurrency, formatDate } from '@/utils/format';
import { cn } from '@/utils/cn';


const EXPENSE_COLOR = '#EF4444';
const INCOME_COLOR = '#10B981';

const CATEGORY_PALETTE = [
  '#0062FF', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#06B6D4', '#F97316', '#84CC16', '#14B8A6', '#A855F7',
  '#EF4444', '#3B82F6',
];

function formatYAxis(value: number): string {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}万`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const now = dayjs();

  const [year, setYear] = useState(now.year());
  const [month, setMonth] = useState(now.month() + 1);

  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<MonthlyTrend[]>([]);
  const [dailyData, setDailyData] = useState<DailyTrend[]>([]);
  const [categoryData, setCategoryData] = useState<CategoryBreakdown[]>([]);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const transactionsRev = useDataStore((s) => s.transactionsRev);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      statsService.monthlyTrend({ year }),
      statsService.dailyTrend({ year, month }),
      statsService.categoryBreakdown({ year, month, type: 'expense' }),
      transactionsService.list({ per_page: 5 }),
    ])
      .then(([trendData, daily, cats, txData]) => {
        setTrend(trendData);
        setDailyData(daily);
        setCategoryData(cats);
        setRecentTx(txData.data);
      })
      .finally(() => setLoading(false));
  }, [year, month, transactionsRev]);

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
        name: d.category_name,
        value: parseFloat(d.total) || 0,
        icon: d.icon,
        percentage: d.percentage,
      }));
  }, [categoryData]);


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
        symbol: 'none',
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
        symbol: 'none',
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

  function goPrev() {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  }

  function goNext() {
    if (year === now.year() && month >= now.month() + 1) return;
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  }

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
      {/* Header with month navigation */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">月度概览</h1>
        <div className="inline-flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={goPrev}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-base font-semibold w-24 text-center tabular-nums">
            {year}年{month}月
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={goNext}
            disabled={isCurrentMonth}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
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
              <span className="text-xs text-muted-foreground">月度同比</span>
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
            {recentTx.length === 0 ? (
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
                {recentTx.map((tx) => (
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
    </div>
  );
}
