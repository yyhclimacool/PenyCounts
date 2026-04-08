import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import dayjs from 'dayjs';
import {
  Plus,
  Search,
  MapPin,
  Pencil,
  Trash2,
  ReceiptText,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  Clock,
  StickyNote,
  Users,
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
import type { Transaction, Category, Member } from '@/types';
import { formatCurrency, formatDate, formatTime } from '@/utils/format';
import { cn } from '@/utils/cn';
import { useToast } from '@/hooks/useToast';

const PER_PAGE = 20;

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
  const [loading, setLoading] = useState(true);

  const [filterType, setFilterType] = useState<string>('all');
  const [filterCategoryId, setFilterCategoryId] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchText, setSearchText] = useState('');

  const [categories, setCategories] = useState<Category[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [memberTags, setMemberTags] = useState<string[]>([]);
  const [memberInput, setMemberInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const filters: Record<string, unknown> = {
        page,
        per_page: PER_PAGE,
      };
      if (filterType !== 'all') filters.type = filterType;
      if (filterCategoryId !== 'all') filters.category_id = filterCategoryId;
      if (dateFrom) filters.date_from = dateFrom;
      if (dateTo) filters.date_to = dateTo;
      const res = await transactionsService.list(filters);
      setTransactions(res.data);
      setTotal(res.total);
    } catch {
      addToast({ title: '加载交易失败', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [page, filterType, filterCategoryId, dateFrom, dateTo, addToast]);

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
  }, []);

  useEffect(() => {
    if (searchParams.get('add') === 'true') {
      openAddDialog();
      const next = new URLSearchParams(searchParams);
      next.delete('add');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const filteredTransactions = useMemo(() => {
    if (!searchText.trim()) return transactions;
    const q = searchText.toLowerCase();
    return transactions.filter(
      (tx) =>
        tx.category?.name?.toLowerCase().includes(q) ||
        tx.subcategory?.name?.toLowerCase().includes(q) ||
        tx.location?.toLowerCase().includes(q) ||
        tx.note?.toLowerCase().includes(q),
    );
  }, [transactions, searchText]);

  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of filteredTransactions) {
      const arr = map.get(tx.date) ?? [];
      arr.push(tx);
      map.set(tx.date, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredTransactions]);

  const totalPages = Math.ceil(total / PER_PAGE);

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.type === form.type),
    [categories, form.type],
  );

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === form.category_id),
    [categories, form.category_id],
  );

  function openAddDialog() {
    setEditingTx(null);
    setForm(defaultForm);
    setMemberTags([]);
    setMemberInput('');
    setDialogOpen(true);
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
      const members =
        memberTags.length > 0
          ? memberTags.map((name) => ({
              member_name: name,
              share_amount: (
                parseFloat(form.amount) / memberTags.length
              ).toFixed(2),
            }))
          : undefined;

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
        members,
      };

      if (editingTx) {
        await transactionsService.update(editingTx.id, payload);
        addToast({ title: '交易已更新' });
      } else {
        await transactionsService.create(payload);
        addToast({ title: '交易已添加' });
      }

      setDialogOpen(false);
      fetchTransactions();
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
    } catch {
      addToast({ title: '删除失败', variant: 'destructive' });
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
    <div className="space-y-4 p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">交易记录</h1>
        <Button onClick={openAddDialog}>
          <Plus className="h-4 w-4" />
          添加交易
        </Button>
      </div>

      {/* Filters Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                开始日期
              </Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                结束日期
              </Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                类型
              </Label>
              <Select
                value={filterType}
                onValueChange={(v) => {
                  setFilterType(v);
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="income">收入</SelectItem>
                  <SelectItem value="expense">支出</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                分类
              </Label>
              <Select
                value={filterCategoryId}
                onValueChange={(v) => {
                  setFilterCategoryId(v);
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
              <Label className="text-xs text-muted-foreground mb-1.5 block">
                搜索
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="分类、地点、备注..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transaction List */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredTransactions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16">
            <ReceiptText className="h-14 w-14 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground text-sm mb-3">
              暂无交易记录
            </p>
            <Button variant="outline" size="sm" onClick={openAddDialog}>
              <Plus className="h-4 w-4" />
              添加交易
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([date, txs]) => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-sm font-semibold text-foreground">
                  {formatDate(date)}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({dayjs(date).format('ddd')})
                </span>
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {txs.length} 笔
                </span>
              </div>
              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  {txs.map((tx) => {
                    const isExpanded = expandedId === tx.id;
                    return (
                      <div key={tx.id}>
                        <div
                          className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() =>
                            setExpandedId(isExpanded ? null : tx.id)
                          }
                        >
                          <span className="text-xl w-9 h-9 flex items-center justify-center rounded-lg bg-muted/60 shrink-0">
                            {tx.category?.icon ?? '📝'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {tx.category?.name ?? '未分类'}
                              {tx.subcategory && (
                                <span className="text-muted-foreground font-normal">
                                  {' / '}
                                  {tx.subcategory.name}
                                </span>
                              )}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                              {tx.time && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Clock className="h-3 w-3" />
                                  {formatTime(tx.time)}
                                </span>
                              )}
                              {tx.location && (
                                <span className="inline-flex items-center gap-0.5">
                                  <MapPin className="h-3 w-3" />
                                  {tx.location}
                                </span>
                              )}
                              {tx.members && tx.members.length > 0 && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Users className="h-3 w-3" />
                                  {tx.members.length}人
                                </span>
                              )}
                            </div>
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
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                        </div>

                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 bg-muted/20 space-y-3 animate-fade-in">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                              <div>
                                <span className="text-xs text-muted-foreground">
                                  日期
                                </span>
                                <p className="font-medium">
                                  {formatDate(tx.date)}
                                </p>
                              </div>
                              <div>
                                <span className="text-xs text-muted-foreground">
                                  时间
                                </span>
                                <p className="font-medium">
                                  {formatTime(tx.time) || '-'}
                                </p>
                              </div>
                              <div>
                                <span className="text-xs text-muted-foreground">
                                  地点
                                </span>
                                <p className="font-medium">
                                  {tx.location || '-'}
                                </p>
                              </div>
                              <div>
                                <span className="text-xs text-muted-foreground">
                                  币种
                                </span>
                                <p className="font-medium">{tx.currency}</p>
                              </div>
                            </div>

                            {tx.note && (
                              <div className="flex items-start gap-2 text-sm">
                                <StickyNote className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                                <p className="text-muted-foreground">
                                  {tx.note}
                                </p>
                              </div>
                            )}

                            {tx.members && tx.members.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {tx.members.map((m) => (
                                  <Badge
                                    key={m.id}
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    {m.member_name}
                                    <span className="ml-1 text-muted-foreground">
                                      {formatCurrency(
                                        m.share_amount,
                                        tx.currency,
                                      )}
                                    </span>
                                  </Badge>
                                ))}
                              </div>
                            )}

                            <div className="flex gap-2 pt-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditDialog(tx);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                编辑
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingId(tx.id);
                                  setDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                删除
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
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
            <ChevronRight className="h-4 w-4" />
          </Button>
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

          <div className="space-y-4 py-2">
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
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => updateForm('date', e.target.value)}
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
              <Label>成员</Label>
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
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <input
                  value={memberInput}
                  onChange={(e) => setMemberInput(e.target.value)}
                  onKeyDown={handleMemberKeyDown}
                  placeholder={
                    memberTags.length === 0
                      ? '输入成员姓名，按回车添加'
                      : ''
                  }
                  className="flex-1 min-w-[120px] outline-none bg-transparent text-sm py-1"
                />
              </div>
              {allMembers.length > 0 && memberTags.length === 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {allMembers.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors cursor-pointer"
                      onClick={() =>
                        setMemberTags((prev) =>
                          prev.includes(m.name)
                            ? prev
                            : [...prev, m.name],
                        )
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
                <Loader2 className="h-4 w-4 animate-spin" />
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
