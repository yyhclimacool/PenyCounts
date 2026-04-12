import { useState, useEffect, useCallback, useMemo } from 'react';
import dayjs from 'dayjs';
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
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Sector,
  BarChart,
  Bar,
  AreaChart,
  Area,
} from 'recharts';
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
        className="h-8 w-8"
        onClick={() => onChange(year - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-base font-semibold w-16 text-center tabular-nums">
        {year}年
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => onChange(year + 1)}
        disabled={year >= dayjs().year()}
      >
        <ChevronRight className="h-4 w-4" />
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
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function EmptyState({ message = '暂无数据' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <BarChart3 className="h-12 w-12 mb-3 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 shadow-md">
      {label != null && (
        <p className="text-sm font-medium text-card-foreground mb-1.5">
          {label}
        </p>
      )}
      {payload.map((item: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-sm leading-relaxed">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: item.color || item.fill }}
          />
          <span className="text-muted-foreground">{item.name}:</span>
          <span className="font-medium text-card-foreground">
            {formatCurrency(item.value, 'CNY')}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/*  Tab 1 — Overview / Summary Analysis                                */
/* ================================================================== */

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

function OverviewTab() {
  const currentYear = dayjs().year();
  const currentMonth = dayjs().month() + 1;

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
  }, [year]);

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
  }, [year, selectedMonth]);

  useEffect(() => {
    let cancelled = false;
    setYearlyLoading(true);
    statsService
      .yearlyTrend()
      .then((d) => !cancelled && setYearlyData(d))
      .catch(() => !cancelled && setYearlyData([]))
      .finally(() => !cancelled && setYearlyLoading(false));
    return () => { cancelled = true; };
  }, []);

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

  return (
    <div className="space-y-6">
      {/* Type toggle for all sections */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <YearSelector year={year} onChange={setYear} />
        <TypeToggle value={viewType} onChange={setViewType} />
      </div>

      {/* ── Section 1: Monthly Trend ── */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
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
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={monthlyChartData} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                    <XAxis
                      dataKey="month"
                      tickFormatter={(v) => `${v}月`}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tickFormatter={formatYAxis}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      width={55}
                    />
                    <Tooltip content={<ChartTooltip />} labelFormatter={(v) => `${v}月`} />
                    <Legend formatter={(value: string) => <span className="text-sm">{value}</span>} />
                    {showIncome && <Bar dataKey="income" name="收入" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} />}
                    {showExpense && <Bar dataKey="expense" name="支出" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} />}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-income/10 rounded-lg">
                      <TrendingUp className="h-4 w-4 text-income" />
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
                      <TrendingDown className="h-4 w-4 text-expense" />
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
                      <PiggyBank className="h-4 w-4 text-primary" />
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

      {/* ── Section 2: Daily Trend ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
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
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={dailyChartData}>
                    <defs>
                      <linearGradient id="gradIncome" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={INCOME_COLOR} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={INCOME_COLOR} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradExpense" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={EXPENSE_COLOR} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={EXPENSE_COLOR} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(v) => `${v}日`}
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      interval={Math.floor(dailyChartData.length / 10)}
                    />
                    <YAxis
                      tickFormatter={formatYAxis}
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      width={50}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      labelFormatter={(v) => `${selectedMonth}月${v}日`}
                    />
                    <Legend formatter={(value: string) => <span className="text-sm">{value}</span>} />
                    {showIncome && (
                      <Area
                        type="monotone"
                        dataKey="income"
                        name="收入"
                        stroke={INCOME_COLOR}
                        strokeWidth={2}
                        fill="url(#gradIncome)"
                      />
                    )}
                    {showExpense && (
                      <Area
                        type="monotone"
                        dataKey="expense"
                        name="支出"
                        stroke={EXPENSE_COLOR}
                        strokeWidth={2}
                        fill="url(#gradExpense)"
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
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

      {/* ── Section 3: Yearly Trend ── */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          年度趋势
        </h2>

        {yearlyLoading ? (
          <Spinner />
        ) : yearlyChartData.length === 0 ? (
          <EmptyState message="暂无年度数据" />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={yearlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                  <XAxis
                    dataKey="year"
                    tickFormatter={(v) => `${v}`}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={formatYAxis}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    width={55}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    labelFormatter={(v) => `${v}年`}
                  />
                  <Legend formatter={(value: string) => <span className="text-sm">{value}</span>} />
                  {showIncome && (
                    <Line
                      type="monotone"
                      dataKey="income"
                      name="收入"
                      stroke={INCOME_COLOR}
                      strokeWidth={2.5}
                      dot={{ r: 5, fill: INCOME_COLOR, strokeWidth: 0 }}
                      activeDot={{ r: 7, strokeWidth: 0 }}
                    />
                  )}
                  {showExpense && (
                    <Line
                      type="monotone"
                      dataKey="expense"
                      name="支出"
                      stroke={EXPENSE_COLOR}
                      strokeWidth={2.5}
                      dot={{ r: 5, fill: EXPENSE_COLOR, strokeWidth: 0 }}
                      activeDot={{ r: 7, strokeWidth: 0 }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
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
  const [activeIndex, setActiveIndex] = useState(-1);

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
    return () => {
      cancelled = true;
    };
  }, [year, month, type]);

  const sorted = [...data].sort(
    (a, b) => parseFloat(b.total) - parseFloat(a.total),
  );
  const total = sorted.reduce((s, d) => s + (parseFloat(d.total) || 0), 0);

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

  return (
    <div className="space-y-4">
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
              <div className="relative">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart
                    onMouseLeave={() => setActiveIndex(-1)}
                  >
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={72}
                      outerRadius={120}
                      dataKey="value"
                      nameKey="name"
                      paddingAngle={2}
                      strokeWidth={0}
                      shape={(props: any) => {
                        const isActive = props.index === activeIndex;
                        const dimmed = activeIndex >= 0 && !isActive;
                        return (
                          <Sector
                            {...props}
                            innerRadius={isActive ? props.innerRadius - 3 : props.innerRadius}
                            outerRadius={isActive ? props.outerRadius + 8 : props.outerRadius}
                            opacity={dimmed ? 0.4 : 1}
                            style={{
                              transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
                              filter: isActive ? 'drop-shadow(0 4px 12px rgba(0,0,0,0.18))' : 'none',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={() => setActiveIndex(props.index)}
                          />
                        );
                      }}
                    >
                      {pieData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div
                    key={activeIndex >= 0 ? activeIndex : 'default'}
                    className={cn(
                      'text-center',
                      activeIndex >= 0
                        ? 'animate-in fade-in-0 zoom-in-90 duration-300'
                        : 'animate-in fade-in-0 duration-200',
                    )}
                  >
                    {activeIndex >= 0 && pieData[activeIndex] ? (
                      <>
                        <p className="text-sm font-semibold">
                          {pieData[activeIndex].icon} {pieData[activeIndex].name}
                        </p>
                        <p className="text-lg font-bold mt-0.5">
                          {formatCurrency(pieData[activeIndex].value, 'CNY')}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          占比 {pieData[activeIndex].percentage.toFixed(1)}%
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {type === 'expense' ? '总支出' : '总收入'}
                        </p>
                        <p className="text-lg font-bold">
                          {formatCurrency(total, 'CNY')}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2">
                {sorted.map((cat, i) => (
                  <div
                    key={cat.category_name}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{
                        backgroundColor: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
                      }}
                    />
                    <span>
                      {cat.icon} {cat.category_name}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">分类排名</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer
                width="100%"
                height={Math.max(180, barData.length * 44)}
              >
                <BarChart
                  data={barData}
                  layout="vertical"
                  margin={{ left: 10, right: 90 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    strokeOpacity={0.15}
                  />
                  <XAxis
                    type="number"
                    tickFormatter={formatYAxis}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="value"
                    name="金额"
                    radius={[0, 4, 4, 0]}
                    barSize={22}
                    label={({ x, y, width, height, index }: any) => {
                      const d = barData[index];
                      if (!d) return null;
                      return (
                        <text
                          x={Number(x) + Number(width) + 6}
                          y={Number(y) + Number(height) / 2 + 4}
                          fontSize={11}
                          fill="#64748b"
                        >
                          {d.percentage.toFixed(1)}%
                        </text>
                      );
                    }}
                  >
                    {barData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
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
    return () => {
      cancelled = true;
    };
  }, [year, month, viewType]);

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
  const barLabel = viewType === 'income' ? '收入' : viewType === 'expense' ? '支出' : '金额';

  return (
    <div className="space-y-4">
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
            <ResponsiveContainer
              width="100%"
              height={Math.max(180, barData.length * 52)}
            >
              <BarChart
                data={barData}
                layout="vertical"
                margin={{ left: 10, right: 130 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  horizontal={false}
                  strokeOpacity={0.15}
                />
                <XAxis
                  type="number"
                  tickFormatter={formatYAxis}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={70}
                  fontSize={13}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="total"
                  name={barLabel}
                  radius={[0, 4, 4, 0]}
                  barSize={28}
                  label={({ x, y, width, height, value, index }: any) => {
                    const d = barData[index];
                    if (!d) return null;
                    return (
                      <text
                        x={Number(x) + Number(width) + 8}
                        y={Number(y) + Number(height) / 2 + 4}
                        fontSize={11}
                        fill="#64748b"
                      >
                        {formatCurrency(value, 'CNY')} (
                        {d.percentage.toFixed(1)}%)
                      </text>
                    );
                  }}
                >
                  {barData.map((_, i) => {
                    const hex = barColor.replace('#', '');
                    const r = parseInt(hex.slice(0, 2), 16);
                    const g = parseInt(hex.slice(2, 4), 16);
                    const b = parseInt(hex.slice(4, 6), 16);
                    const opacity = 1 - (i / Math.max(barData.length - 1, 1)) * 0.6;
                    return (
                      <Cell key={i} fill={`rgba(${r}, ${g}, ${b}, ${opacity})`} />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    statsService
      .socialSummary({ year })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [year]);

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

  return (
    <div className="space-y-4">
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
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    strokeOpacity={0.15}
                  />
                  <XAxis
                    dataKey="name"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={chartData.length > 6 ? -35 : 0}
                    textAnchor={chartData.length > 6 ? 'end' : 'middle'}
                    height={chartData.length > 6 ? 70 : 30}
                  />
                  <YAxis
                    tickFormatter={formatYAxis}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={55}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-sm">{value}</span>
                    )}
                  />
                  {showGiven && (
                    <Bar
                      dataKey="given"
                      name="送出"
                      fill={EXPENSE_COLOR}
                      radius={[4, 4, 0, 0]}
                    />
                  )}
                  {showReceived && (
                    <Bar
                      dataKey="received"
                      name="收到"
                      fill={INCOME_COLOR}
                      radius={[4, 4, 0, 0]}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
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
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl mx-auto">
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
