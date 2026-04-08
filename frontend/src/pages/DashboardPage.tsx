import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Plus,
  ArrowRight,
  MapPin,
  ReceiptText,
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
import type { MonthlyTrend, Transaction } from '@/types';
import { formatCurrency, formatDate } from '@/utils/format';
import { cn } from '@/utils/cn';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<MonthlyTrend[]>([]);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);

  useEffect(() => {
    const year = dayjs().year();
    Promise.all([
      statsService.monthlyTrend({ year }),
      transactionsService.list({ per_page: 10 }),
    ])
      .then(([trendData, txData]) => {
        setTrend(trendData);
        setRecentTx(txData.data);
      })
      .finally(() => setLoading(false));
  }, []);

  const currentMonth = dayjs().month() + 1;
  const currentMonthData = trend.find((t) => t.month === currentMonth);
  const totalIncome = parseFloat(currentMonthData?.income ?? '0');
  const totalExpense = parseFloat(currentMonthData?.expense ?? '0');
  const net = totalIncome - totalExpense;

  const last6 = trend.slice(-6);
  const maxVal = Math.max(
    ...last6.map((t) =>
      Math.max(parseFloat(t.income), parseFloat(t.expense)),
    ),
    1,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl mx-auto relative min-h-screen pb-24">
      <h1 className="text-2xl font-bold tracking-tight">
        {dayjs().format('YYYY年M月')} 总览
      </h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-income/10 rounded-xl">
                <TrendingUp className="h-5 w-5 text-income" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">
                本月收入
              </span>
            </div>
            <p className="text-3xl font-bold text-income tracking-tight">
              {formatCurrency(totalIncome, 'CNY')}
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-expense/10 rounded-xl">
                <TrendingDown className="h-5 w-5 text-expense" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">
                本月支出
              </span>
            </div>
            <p className="text-3xl font-bold text-expense tracking-tight">
              {formatCurrency(totalExpense, 'CNY')}
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-primary/10 rounded-xl">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">
                净额
              </span>
            </div>
            <p
              className={cn(
                'text-3xl font-bold tracking-tight',
                net >= 0 ? 'text-primary' : 'text-expense',
              )}
            >
              {net >= 0 ? '+' : ''}
              {formatCurrency(net, 'CNY')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle>最近交易</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/transactions')}
            className="text-muted-foreground hover:text-foreground"
          >
            查看全部
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </CardHeader>
        <CardContent>
          {recentTx.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-muted-foreground">
              <ReceiptText className="h-12 w-12 mb-3 opacity-40" />
              <p className="text-sm">暂无交易记录</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => navigate('/transactions?add=true')}
              >
                <Plus className="h-4 w-4" />
                添加第一笔交易
              </Button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {recentTx.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                  onClick={() => navigate('/transactions')}
                >
                  <span className="text-xl w-9 h-9 flex items-center justify-center rounded-lg bg-muted/60 shrink-0">
                    {tx.category?.icon ?? '📝'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {tx.category?.name ?? '未分类'}
                      {tx.subcategory && (
                        <span className="text-muted-foreground font-normal">
                          {' '}
                          / {tx.subcategory.name}
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <span>{formatDate(tx.date)}</span>
                      {tx.location && (
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" />
                          {tx.location}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'text-sm font-semibold tabular-nums whitespace-nowrap',
                      tx.type === 'income' ? 'text-income' : 'text-expense',
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

      {/* Mini Monthly Chart */}
      {last6.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>月度趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 sm:gap-5 h-44 px-2">
              {last6.map((m) => {
                const inc = parseFloat(m.income);
                const exp = parseFloat(m.expense);
                const incH = maxVal > 0 ? (inc / maxVal) * 100 : 0;
                const expH = maxVal > 0 ? (exp / maxVal) * 100 : 0;
                return (
                  <div
                    key={m.month}
                    className="flex-1 flex flex-col items-center gap-1.5"
                  >
                    <div className="flex items-end gap-1 w-full h-32">
                      <div className="relative flex-1 group/bar">
                        <div
                          className="w-full bg-income/20 rounded-t-md transition-all duration-500 hover:bg-income/30"
                          style={{ height: `${Math.max(incH, 2)}%` }}
                        />
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover/bar:opacity-100 transition-opacity text-[10px] text-muted-foreground whitespace-nowrap bg-popover border rounded px-1.5 py-0.5 shadow-sm pointer-events-none">
                          {formatCurrency(inc, 'CNY')}
                        </div>
                      </div>
                      <div className="relative flex-1 group/bar">
                        <div
                          className="w-full bg-expense/20 rounded-t-md transition-all duration-500 hover:bg-expense/30"
                          style={{ height: `${Math.max(expH, 2)}%` }}
                        />
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover/bar:opacity-100 transition-opacity text-[10px] text-muted-foreground whitespace-nowrap bg-popover border rounded px-1.5 py-0.5 shadow-sm pointer-events-none">
                          {formatCurrency(exp, 'CNY')}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">
                      {m.month}月
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-6 mt-5 pt-4 border-t">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded-sm bg-income/20 border border-income/30" />
                收入
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded-sm bg-expense/20 border border-expense/30" />
                支出
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
