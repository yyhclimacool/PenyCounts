import { useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  X,
  BarChart3,
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
  BarChart,
  Bar,
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
import { Separator } from '@/components/ui/separator';
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
  Transaction,
  CategoryBreakdown,
  MemberBreakdown,
  SocialSummary,
} from '@/types';
import { formatCurrency, formatDate } from '@/utils/format';
import { cn } from '@/utils/cn';

const INCOME_COLOR = '#22c55e';
const EXPENSE_COLOR = '#ef4444';
const PRIMARY_COLOR = '#6366f1';

const CATEGORY_PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#f97316', '#84cc16', '#14b8a6', '#a855f7',
  '#ef4444', '#3b82f6',
];

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function formatYAxis(value: number): string {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}万`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
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
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-28 h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">全部月份</SelectItem>
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
/*  Tab 1 — Monthly Trend                                              */
/* ================================================================== */

function MonthlyTrendTab() {
  const [year, setYear] = useState(dayjs().year());
  const [trend, setTrend] = useState<MonthlyTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [detail, setDetail] = useState<Transaction[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchTrend = useCallback(async (y: number) => {
    setLoading(true);
    setSelectedMonth(null);
    try {
      const data = await statsService.monthlyTrend({ year: y });
      setTrend(data);
    } catch {
      setTrend([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrend(year);
  }, [year, fetchTrend]);

  const fetchDetail = useCallback(
    async (month: number) => {
      setDetailLoading(true);
      try {
        const data = await statsService.monthlyDetail({ year, month });
        setDetail(data);
      } catch {
        setDetail([]);
      } finally {
        setDetailLoading(false);
      }
    },
    [year],
  );

  useEffect(() => {
    if (selectedMonth) fetchDetail(selectedMonth);
  }, [selectedMonth, fetchDetail]);

  const chartData = MONTHS.map((m) => {
    const row = trend.find((t) => t.month === m);
    return {
      month: m,
      income: parseFloat(row?.income ?? '0') || 0,
      expense: parseFloat(row?.expense ?? '0') || 0,
    };
  });

  const totalIncome = chartData.reduce((s, d) => s + d.income, 0);
  const totalExpense = chartData.reduce((s, d) => s + d.expense, 0);
  const savingsRate =
    totalIncome > 0
      ? ((totalIncome - totalExpense) / totalIncome) * 100
      : 0;

  const handleChartClick = (state: any) => {
    const month = state?.activePayload?.[0]?.payload?.month as
      | number
      | undefined;
    if (month) setSelectedMonth(month === selectedMonth ? null : month);
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <YearSelector year={year} onChange={setYear} />
      </div>

      {trend.length === 0 ? (
        <EmptyState message="该年度暂无数据" />
      ) : (
        <>
          {/* Line Chart */}
          <Card>
            <CardContent className="pt-6">
              <ResponsiveContainer width="100%" height={350}>
                <LineChart
                  data={chartData}
                  onClick={handleChartClick}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    strokeOpacity={0.2}
                  />
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
                  <Tooltip
                    content={
                      <ChartTooltip />
                    }
                    labelFormatter={(v) => `${v}月`}
                  />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-sm">{value}</span>
                    )}
                  />
                  <Line
                    type="monotone"
                    dataKey="income"
                    name="收入"
                    stroke={INCOME_COLOR}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: INCOME_COLOR, strokeWidth: 0 }}
                    activeDot={{ r: 7, strokeWidth: 0 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="expense"
                    name="支出"
                    stroke={EXPENSE_COLOR}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: EXPENSE_COLOR, strokeWidth: 0 }}
                    activeDot={{ r: 7, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              {selectedMonth && (
                <p className="text-xs text-center text-muted-foreground mt-2">
                  已选择 {selectedMonth}月，点击相同月份可关闭
                </p>
              )}
            </CardContent>
          </Card>

          {/* Monthly Detail */}
          {selectedMonth && (
            <Card className="animate-fade-in">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">
                  {year}年{selectedMonth}月 交易明细
                </CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setSelectedMonth(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <Separator />
              <CardContent className="pt-3 max-h-80 overflow-y-auto">
                {detailLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : detail.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    该月暂无交易
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {detail.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <span className="text-lg w-8 h-8 flex items-center justify-center rounded-lg bg-muted/60 shrink-0">
                          {tx.category?.icon ?? '📝'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {tx.category?.name ?? '未分类'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(tx.date)}
                            {tx.note && ` · ${tx.note}`}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'text-sm font-semibold tabular-nums whitespace-nowrap',
                            tx.type === 'income'
                              ? 'text-income'
                              : 'text-expense',
                          )}
                        >
                          {tx.type === 'income' ? '+' : '-'}
                          {formatCurrency(tx.amount, tx.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-income/10 rounded-lg">
                    <TrendingUp className="h-4 w-4 text-income" />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    年度总收入
                  </span>
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
                  <span className="text-sm text-muted-foreground">
                    年度总支出
                  </span>
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
                <p
                  className={cn(
                    'text-2xl font-bold tabular-nums',
                    savingsRate >= 0 ? 'text-primary' : 'text-expense',
                  )}
                >
                  {savingsRate.toFixed(1)}%
                </p>
              </CardContent>
            </Card>
          </div>
        </>
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
  const [loading, setLoading] = useState(true);

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
      {/* Controls */}
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
          {/* Donut Pie */}
          <Card>
            <CardContent className="pt-6">
              <div className="relative">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
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
                    >
                      {pieData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={
                            CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="rounded-lg border bg-card px-3 py-2 shadow-md text-sm">
                            <p className="font-medium">
                              {d.icon} {d.name}
                            </p>
                            <p className="text-muted-foreground">
                              {formatCurrency(d.value, 'CNY')} (
                              {d.percentage.toFixed(1)}%)
                            </p>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center label */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">
                      {type === 'expense' ? '总支出' : '总收入'}
                    </p>
                    <p className="text-lg font-bold">
                      {formatCurrency(total, 'CNY')}
                    </p>
                  </div>
                </div>
              </div>
              {/* Custom legend */}
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2">
                {sorted.map((cat, i) => (
                  <div
                    key={cat.category_name}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
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

          {/* Category Ranking */}
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
                        fill={
                          CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]
                        }
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
  const [data, setData] = useState<MemberBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    statsService
      .memberBreakdown({
        year,
        ...(month !== 'all' && { month: Number(month) }),
      })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [year, month]);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <YearSelector year={year} onChange={setYear} />
        <MonthSelect value={month} onChange={setMonth} />
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
                  name="支出"
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
                  {barData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={`rgba(99, 102, 241, ${1 - (i / Math.max(barData.length - 1, 1)) * 0.6})`}
                    />
                  ))}
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
/*  Tab 4 — Social Gifts Summary                                       */
/* ================================================================== */

function SocialGiftsTab() {
  const [year, setYear] = useState(dayjs().year());
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
    given: parseFloat(d.given) || 0,
    received: parseFloat(d.received) || 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <YearSelector year={year} onChange={setYear} />
      </div>

      {loading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Summary */}
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

          {/* Grouped Bar Chart */}
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
                  <Bar
                    dataKey="given"
                    name="送出"
                    fill={EXPENSE_COLOR}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="received"
                    name="收到"
                    fill={INCOME_COLOR}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Detail Table */}
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
                      <th className="text-right py-2.5 font-medium">送出</th>
                      <th className="text-right py-2.5 font-medium">收到</th>
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
                          <td className="py-2.5 text-right text-expense tabular-nums">
                            {formatCurrency(row.given, 'CNY')}
                          </td>
                          <td className="py-2.5 text-right text-income tabular-nums">
                            {formatCurrency(row.received, 'CNY')}
                          </td>
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

      <Tabs defaultValue="trend">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="trend" className="text-xs sm:text-sm">
            月度趋势
          </TabsTrigger>
          <TabsTrigger value="category" className="text-xs sm:text-sm">
            分类分析
          </TabsTrigger>
          <TabsTrigger value="member" className="text-xs sm:text-sm">
            人员分析
          </TabsTrigger>
          <TabsTrigger value="social" className="text-xs sm:text-sm">
            人情汇总
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trend">
          <MonthlyTrendTab />
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
