import { useEffect, useState, useMemo } from 'react';
import { Loader2, ReceiptText, MapPin } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import * as transactionsService from '@/services/transactions';
import * as categoriesService from '@/services/categories';
import type { Transaction, Category } from '@/types';
import { formatCurrency, formatDate } from '@/utils/format';
import { cn } from '@/utils/cn';

interface TransactionListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  type?: 'income' | 'expense';
}

export function TransactionListDialog({
  open,
  onOpenChange,
  title,
  startDate,
  endDate,
  categoryId,
  type,
}: TransactionListDialogProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      transactionsService.list({
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        ...(categoryId && { category_id: categoryId }),
        ...(type && { type }),
        per_page: 100,
      }),
      categoriesService.getAll(),
    ])
      .then(([res, cats]) => {
        setTransactions(res.data);
        setTotal(res.total);
        setCategories(cats);
      })
      .catch(() => {
        setTransactions([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [open, startDate, endDate, categoryId, type]);

  const enrichedTransactions = useMemo(() => {
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const subMap = new Map(
      categories.flatMap((c) => (c.subcategories ?? []).map((s) => [s.id, s])),
    );
    return transactions.map((tx) => ({
      ...tx,
      category: catMap.get(tx.category_id),
      subcategory: tx.subcategory_id ? subMap.get(tx.subcategory_id) : undefined,
    }));
  }, [transactions, categories]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {!loading && (
            <DialogDescription>
              共 {total} 笔交易
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : enrichedTransactions.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-muted-foreground">
              <ReceiptText className="size-10 mb-2 opacity-40" />
              <p className="text-sm">暂无交易记录</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {enrichedTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <span className="text-lg size-8 flex items-center justify-center rounded-lg bg-muted/60 shrink-0">
                    {tx.category?.icon ?? '📝'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {tx.category?.name ?? '未分类'}
                      {tx.subcategory && (
                        <span className="text-muted-foreground font-normal">
                          {' '}/ {tx.subcategory.name}
                        </span>
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
                      {tx.note && (
                        <span className="truncate max-w-[120px]">{tx.note}</span>
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
              {total > 100 && (
                <p className="text-xs text-center text-muted-foreground py-2">
                  仅显示前 100 条，共 {total} 条
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
