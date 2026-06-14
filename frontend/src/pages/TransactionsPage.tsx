import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import dayjs from 'dayjs';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  ReceiptText,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  Upload,
  Download,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import * as transactionsService from '@/services/transactions';
import * as categoriesService from '@/services/categories';
import * as membersService from '@/services/members';
import { useDataStore } from '@/stores/dataStore';
import type { Transaction, Category, Member } from '@/types';
import { formatCurrency } from '@/utils/format';
import { cn } from '@/utils/cn';
import { useToast } from '@/hooks/useToast';
import { DatePicker } from '@/components/ui/date-picker';
import { loadPersisted, savePersisted } from '@/utils/persist';
import { usePersistentState } from '@/hooks/usePersistentState';

const LAST_TX_DATE_KEY = 'tx:lastDate';

const PAGE_SIZE_OPTIONS = [20, 50, 100];

interface FormState {
  type: 'income' | 'expense';
  amount: string;
  currency: string;
  category_id: string;
  subcategory_id: string;
  date: string;
  time: string;
  location: string;
  note: string;
}

const defaultForm: FormState = {
  type: 'expense',
  amount: '',
  currency: 'CNY',
  category_id: '',
  subcategory_id: '',
  date: dayjs().format('YYYY-MM-DD'),
  time: dayjs().format('HH:mm'),
  location: '',
  note: '',
};

export default function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useToast();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [loading, setLoading] = useState(true);

  const [filterType, setFilterType] = useState<string>('all');
  const [filterCategoryId, setFilterCategoryId] = useState<string>('all');
  const [filterSubcategoryId, setFilterSubcategoryId] = useState<string>('all');
  const [filterMember, setFilterMember] = useState<string>('all');
  const [dateFrom, setDateFrom] = usePersistentState('tx:filterDateFrom', '');
  const [dateTo, setDateTo] = usePersistentState('tx:filterDateTo', '');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [categories, setCategories] = useState<Category[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [memberTags, setMemberTags] = useState<string[]>([]);
  const [memberInput, setMemberInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transactionsRev = useDataStore((s) => s.transactionsRev);
  const categoriesRev = useDataStore((s) => s.categoriesRev);
  const membersRev = useDataStore((s) => s.membersRev);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const filters: Record<string, unknown> = {
        page,
        per_page: perPage,
      };
      if (filterType !== 'all') filters.type = filterType;
      if (filterCategoryId !== 'all') filters.category_id = filterCategoryId;
      if (filterSubcategoryId !== 'all') filters.subcategory_id = filterSubcategoryId;
      if (filterMember !== 'all') filters.member_name = filterMember;
      if (dateFrom) filters.start_date = dateFrom;
      if (dateTo) filters.end_date = dateTo;
      if (minAmount) filters.min_amount = minAmount;
      if (maxAmount) filters.max_amount = maxAmount;
      if (searchText.trim()) filters.search = searchText.trim();
      const res = await transactionsService.list(filters);
      setTransactions(res.data);
      setTotal(res.total);
    } catch {
      addToast({ title: '加载交易失败', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [page, perPage, filterType, filterCategoryId, filterSubcategoryId, filterMember, dateFrom, dateTo, minAmount, maxAmount, searchText, addToast, transactionsRev]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    Promise.all([categoriesService.getAll(), membersService.list()]).then(
      ([cats, mems]) => {
        setCategories(cats);
        setAllMembers(mems);
      },
    );
  }, [categoriesRev, membersRev]);

  useEffect(() => {
    if (searchParams.get('add') === 'true') {
      openAddDialog();
      const next = new URLSearchParams(searchParams);
      next.delete('add');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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

  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of enrichedTransactions) {
      const monthKey = tx.date.slice(0, 7);
      const arr = map.get(monthKey) ?? [];
      arr.push(tx);
      map.set(monthKey, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [enrichedTransactions]);

  const totalPages = Math.ceil(total / perPage);

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.type === form.type),
    [categories, form.type],
  );

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === form.category_id),
    [categories, form.category_id],
  );

  const filterSubcategories = useMemo(() => {
    if (filterCategoryId === 'all') return [];
    const cat = categories.find((c) => c.id === filterCategoryId);
    return cat?.subcategories ?? [];
  }, [categories, filterCategoryId]);

  function openAddDialog() {
    setEditingTx(null);
    // Default to the last date the user picked (persisted), not always today.
    setForm({
      ...defaultForm,
      date: loadPersisted(LAST_TX_DATE_KEY, defaultForm.date),
    });
    setMemberTags([]);
    setMemberInput('');
    setDialogOpen(true);
  }

  const hasActiveFilters =
    filterType !== 'all' ||
    filterCategoryId !== 'all' ||
    filterSubcategoryId !== 'all' ||
    filterMember !== 'all' ||
    dateFrom !== '' ||
    dateTo !== '' ||
    minAmount !== '' ||
    maxAmount !== '' ||
    searchInput !== '';

  function resetFilters() {
    clearTimeout(searchTimerRef.current);
    setFilterType('all');
    setFilterCategoryId('all');
    setFilterSubcategoryId('all');
    setFilterMember('all');
    setDateFrom('');
    setDateTo('');
    setMinAmount('');
    setMaxAmount('');
    setSearchText('');
    setSearchInput('');
    setPage(1);
  }

  function openEditDialog(tx: Transaction) {
    setEditingTx(tx);
    setForm({
      type: tx.type,
      amount: tx.amount,
      currency: tx.currency,
      category_id: tx.category_id,
      subcategory_id: tx.subcategory_id ?? '',
      date: tx.date,
      time: tx.time,
      location: tx.location ?? '',
      note: tx.note ?? '',
    });
    setMemberTags(tx.members?.map((m) => m.member_name) ?? []);
    setMemberInput('');
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!form.amount || parseFloat(form.amount) <= 0) {
      addToast({ title: '请输入有效金额', variant: 'destructive' });
      return;
    }
    if (!form.category_id) {
      addToast({ title: '请选择分类', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        type: form.type,
        amount: form.amount,
        currency: form.currency,
        category_id: form.category_id,
        subcategory_id: form.subcategory_id || null,
        date: form.date,
        time: form.time,
        location: form.location || null,
        note: form.note || null,
        members: memberTags,
      };

      if (editingTx) {
        await transactionsService.update(editingTx.id, payload);
        addToast({ title: '交易已更新' });
      } else {
        await transactionsService.create(payload);
        addToast({ title: '交易已添加' });
      }

      // Remember this date so the next "add" defaults to it.
      savePersisted(LAST_TX_DATE_KEY, form.date);

      setDialogOpen(false);
      fetchTransactions();
      useDataStore.getState().invalidateTransactions();
      if (memberTags.length > 0) {
        useDataStore.getState().invalidateMembers();
      }
    } catch {
      addToast({ title: '操作失败', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deletingId) return;
    try {
      await transactionsService.deleteTransaction(deletingId);
      addToast({ title: '交易已删除' });
      setDeleteDialogOpen(false);
      setDeletingId(null);
      fetchTransactions();
      useDataStore.getState().invalidateTransactions();
    } catch {
      addToast({ title: '删除失败', variant: 'destructive' });
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    try {
      const content = await file.text();
      const result = await transactionsService.importCsv(content);
      addToast({
        title: `导入完成：共 ${result.total} 条，成功 ${result.imported} 条${result.skipped > 0 ? `，跳过 ${result.skipped} 条` : ''}`,
      });
      if (result.imported > 0) {
        fetchTransactions();
        useDataStore.getState().invalidateTransactions();
        useDataStore.getState().invalidateMembers();
        useDataStore.getState().invalidateCategories();
      }
    } catch {
      addToast({ title: '导入失败', variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const filters: Record<string, unknown> = {};
      if (filterType !== 'all') filters.type = filterType;
      if (filterCategoryId !== 'all') filters.category_id = filterCategoryId;
      if (filterSubcategoryId !== 'all') filters.subcategory_id = filterSubcategoryId;
      if (filterMember !== 'all') filters.member_name = filterMember;
      if (dateFrom) filters.start_date = dateFrom;
      if (dateTo) filters.end_date = dateTo;
      if (minAmount) filters.min_amount = minAmount;
      if (maxAmount) filters.max_amount = maxAmount;
      await transactionsService.exportCsv(filters);
      addToast({ title: '导出成功' });
    } catch {
      addToast({ title: '导出失败', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }

  function handleMemberKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && memberInput.trim()) {
      e.preventDefault();
      const name = memberInput.trim().replace(/,$/, '');
      if (name && !memberTags.includes(name)) {
        setMemberTags((prev) => [...prev, name]);
      }
      setMemberInput('');
    } else if (
      e.key === 'Backspace' &&
      !memberInput &&
      memberTags.length > 0
    ) {
      setMemberTags((prev) => prev.slice(0, -1));
    }
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'type') {
        next.category_id = '';
        next.subcategory_id = '';
      }
      if (key === 'category_id') {
        next.subcategory_id = '';
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">交易记录</h1>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImport}
          />
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            导出 CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            导入 CSV
          </Button>
          <Button onClick={openAddDialog}>
            <Plus className="size-4" />
            添加交易
          </Button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">类型</Label>
              <Select
                value={filterType}
                onValueChange={(v) => { setFilterType(v); setPage(1); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="income">收入</SelectItem>
                  <SelectItem value="expense">支出</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">分类</Label>
              <Select
                value={filterCategoryId}
                onValueChange={(v) => {
                  setFilterCategoryId(v);
                  setFilterSubcategoryId('all');
                  setPage(1);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部分类</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.icon} {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">搜索</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="地点、备注、人员..."
                  value={searchInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSearchInput(val);
                    clearTimeout(searchTimerRef.current);
                    searchTimerRef.current = setTimeout(() => {
                      setSearchText(val);
                      setPage(1);
                    }, 400);
                  }}
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          {/* Advanced filters toggle + reset */}
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              高级筛选
            </button>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={resetFilters}
              >
                <X className="size-3.5" />
                重置搜索条件
              </Button>
            )}
          </div>

          {showAdvanced && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3 pt-3 border-t border-border/50">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">开始日期</Label>
                <DatePicker
                  value={dateFrom}
                  onChange={(v) => { setDateFrom(v); setPage(1); }}
                  placeholder="选择日期"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">结束日期</Label>
                <DatePicker
                  value={dateTo}
                  onChange={(v) => { setDateTo(v); setPage(1); }}
                  placeholder="选择日期"
                />
              </div>
              {filterSubcategories.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">子分类</Label>
                  <Select
                    value={filterSubcategoryId}
                    onValueChange={(v) => { setFilterSubcategoryId(v); setPage(1); }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部子分类</SelectItem>
                      {filterSubcategories.map((sub) => (
                        <SelectItem key={sub.id} value={sub.id}>
                          {sub.icon} {sub.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">人员</Label>
                <Select
                  value={filterMember}
                  onValueChange={(v) => { setFilterMember(v); setPage(1); }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部人员</SelectItem>
                    {allMembers.map((m) => (
                      <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">最小金额</Label>
                <Input
                  type="number"
                  placeholder="不限"
                  value={minAmount}
                  onChange={(e) => { setMinAmount(e.target.value); setPage(1); }}
                  min="0"
                  step="0.01"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">最大金额</Label>
                <Input
                  type="number"
                  placeholder="不限"
                  value={maxAmount}
                  onChange={(e) => { setMaxAmount(e.target.value); setPage(1); }}
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction List */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : enrichedTransactions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16">
            <ReceiptText className="h-14 w-14 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground text-sm mb-3">
              暂无交易记录
            </p>
            <Button variant="outline" size="sm" onClick={openAddDialog}>
              <Plus className="size-4" />
              添加交易
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(([monthKey, txs]) => {
            const monthIncome = txs
              .filter((t) => t.type === 'income')
              .reduce((s, t) => s + parseFloat(t.amount), 0);
            const monthExpense = txs
              .filter((t) => t.type === 'expense')
              .reduce((s, t) => s + parseFloat(t.amount), 0);
            return (
            <div key={monthKey}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-sm font-semibold text-foreground">
                  {dayjs(monthKey + '-01').format('YYYY年M月')}
                </span>
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-income tabular-nums">
                  +{formatCurrency(monthIncome, 'CNY')}
                </span>
                <span className="text-xs text-expense tabular-nums">
                  -{formatCurrency(monthExpense, 'CNY')}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {txs.length}笔
                </span>
              </div>
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <th className="px-4 py-2.5 text-left font-medium">日期</th>
                        <th className="px-3 py-2.5 text-left font-medium">一级分类</th>
                        <th className="px-3 py-2.5 text-left font-medium">二级分类</th>
                        <th className="px-3 py-2.5 text-center font-medium">收支</th>
                        <th className="px-3 py-2.5 text-right font-medium">流水</th>
                        <th className="px-3 py-2.5 text-left font-medium">人员</th>
                        <th className="px-3 py-2.5 text-left font-medium">备注</th>
                        <th className="px-3 py-2.5 text-right font-medium w-20">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {txs.map((tx) => {
                        const amt = parseFloat(tx.amount);
                        const signedAmt = tx.type === 'expense' ? -amt : amt;
                        return (
                          <tr
                            key={tx.id}
                            className="content-auto hover:bg-muted/40 transition-colors"
                          >
                            <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                              {dayjs(tx.date).format('MM-DD')}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="text-base">{tx.category?.icon ?? '📝'}</span>
                                {tx.category?.name ?? '未分类'}
                              </span>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                              {tx.subcategory ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="text-base">{tx.subcategory.icon}</span>
                                  {tx.subcategory.name}
                                </span>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <Badge
                                variant={tx.type === 'income' ? 'default' : 'secondary'}
                                className={cn(
                                  'text-xs font-medium',
                                  tx.type === 'income'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                                )}
                              >
                                {tx.type === 'income' ? '收入' : '支出'}
                              </Badge>
                            </td>
                            <td
                              className={cn(
                                'px-3 py-3 text-right font-semibold tabular-nums whitespace-nowrap',
                                tx.type === 'income'
                                  ? 'text-income'
                                  : 'text-expense',
                              )}
                            >
                              {signedAmt >= 0 ? '+' : ''}{signedAmt.toFixed(2)}
                            </td>
                            <td className="px-3 py-3">
                              {tx.members && tx.members.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {tx.members.map((m) => (
                                    <Badge
                                      key={m.id}
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {m.member_name}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground max-w-[200px] truncate">
                              {tx.note || '-'}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  onClick={() => openEditDialog(tx)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => {
                                    setDeletingId(tx.id);
                                    setDeleteDialogOpen(true);
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>每页</span>
            <Select
              value={String(perPage)}
              onValueChange={(v) => { setPerPage(Number(v)); setPage(1); }}
            >
              <SelectTrigger className="h-8 w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} 条
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="tabular-nums">共 {total} 条</span>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(1)}
              >
                <ChevronsLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-sm text-muted-foreground px-3 tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
              >
                <ChevronsRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTx ? '编辑交易' : '添加交易'}
            </DialogTitle>
            <DialogDescription>
              {editingTx ? '修改交易信息' : '记录一笔新的收入或支出'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {/* Type Toggle */}
            <div className="flex rounded-lg border p-1 gap-1">
              <button
                type="button"
                className={cn(
                  'flex-1 py-2 rounded-md text-sm font-medium transition-all cursor-pointer',
                  form.type === 'expense'
                    ? 'bg-expense text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => updateForm('type', 'expense')}
              >
                支出
              </button>
              <button
                type="button"
                className={cn(
                  'flex-1 py-2 rounded-md text-sm font-medium transition-all cursor-pointer',
                  form.type === 'income'
                    ? 'bg-income text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => updateForm('type', 'income')}
              >
                收入
              </button>
            </div>

            {/* Amount + Currency */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label>金额</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => updateForm('amount', e.target.value)}
                  className="mt-1.5 text-lg font-semibold"
                />
              </div>
              <div>
                <Label>币种</Label>
                <Select
                  value={form.currency}
                  onValueChange={(v) => updateForm('currency', v)}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CNY">CNY ¥</SelectItem>
                    <SelectItem value="USD">USD $</SelectItem>
                    <SelectItem value="EUR">EUR €</SelectItem>
                    <SelectItem value="JPY">JPY ¥</SelectItem>
                    <SelectItem value="GBP">GBP £</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Category + Subcategory */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>分类</Label>
                <Select
                  value={form.category_id}
                  onValueChange={(v) => updateForm('category_id', v)}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="选择分类" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCategories.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        暂无
                        {form.type === 'income' ? '收入' : '支出'}
                        分类
                      </div>
                    ) : (
                      filteredCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.icon} {cat.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>子分类</Label>
                <Select
                  value={form.subcategory_id}
                  onValueChange={(v) => updateForm('subcategory_id', v)}
                  disabled={
                    !selectedCategory ||
                    !selectedCategory.subcategories?.length
                  }
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="选择子分类" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedCategory?.subcategories?.map((sub) => (
                      <SelectItem key={sub.id} value={sub.id}>
                        {sub.icon} {sub.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Date + Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>日期</Label>
                <DatePicker
                  value={form.date}
                  onChange={(v) => updateForm('date', v)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>时间</Label>
                <Input
                  type="time"
                  value={form.time}
                  onChange={(e) => updateForm('time', e.target.value)}
                  className="mt-1.5"
                />
              </div>
            </div>

            {/* Location */}
            <div>
              <Label>地点</Label>
              <Input
                placeholder="输入地点（可选）"
                value={form.location}
                onChange={(e) => updateForm('location', e.target.value)}
                className="mt-1.5"
              />
            </div>

            {/* Members */}
            <div>
              <Label>人员</Label>
              <div className="flex flex-wrap items-center gap-1.5 p-2 border border-input rounded-lg mt-1.5 min-h-10 bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background transition-shadow">
                {memberTags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="gap-1 pr-1"
                  >
                    {tag}
                    <button
                      type="button"
                      className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 cursor-pointer"
                      onClick={() =>
                        setMemberTags((prev) =>
                          prev.filter((t) => t !== tag),
                        )
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
                <input
                  value={memberInput}
                  onChange={(e) => setMemberInput(e.target.value)}
                  onKeyDown={handleMemberKeyDown}
                  placeholder={
                    memberTags.length === 0
                      ? '输入人员姓名，按回车添加'
                      : ''
                  }
                  className="flex-1 min-w-[120px] outline-none bg-transparent text-sm py-1"
                />
              </div>
              {allMembers.filter((m) => !memberTags.includes(m.name)).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {allMembers
                    .filter((m) => !memberTags.includes(m.name))
                    .map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors cursor-pointer"
                        onClick={() =>
                          setMemberTags((prev) => [...prev, m.name])
                        }
                      >
                        + {m.name}
                      </button>
                    ))}
                </div>
              )}
            </div>

            {/* Note */}
            <div>
              <Label>备注</Label>
              <Textarea
                placeholder="添加备注（可选）"
                value={form.note}
                onChange={(e) => updateForm('note', e.target.value)}
                rows={2}
                className="mt-1.5"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {editingTx ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              此操作不可撤销，确定要删除这笔交易吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
