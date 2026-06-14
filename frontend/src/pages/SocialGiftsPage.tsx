import { useState, useEffect, useCallback, useMemo } from 'react';
import dayjs from 'dayjs';
import {
  Plus,
  Search,
  Gift,
  ArrowUpRight,
  ArrowDownLeft,
  Scale,
  Pencil,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import * as socialGiftsService from '@/services/socialGifts';
import * as statsService from '@/services/stats';
import type { SocialGift, SocialSummary } from '@/types';
import { formatCurrency, formatDate } from '@/utils/format';
import { cn } from '@/utils/cn';
import { useToast } from '@/hooks/useToast';
import { DatePicker } from '@/components/ui/date-picker';
import { useDataStore } from '@/stores/dataStore';
import { loadPersisted, savePersisted } from '@/utils/persist';

const PER_PAGE = 20;
const LAST_GIFT_DATE_KEY = 'gift:lastDate';

interface FormState {
  type: 'give' | 'receive';
  person_name: string;
  relation: string;
  occasion: string;
  amount: string;
  currency: string;
  date: string;
  note: string;
}

const defaultForm: FormState = {
  type: 'give',
  person_name: '',
  relation: '',
  occasion: '',
  amount: '',
  currency: 'CNY',
  date: dayjs().format('YYYY-MM-DD'),
  note: '',
};

const RELATIONS = ['亲戚', '朋友', '同事', '同学', '邻居', '长辈', '晚辈', '其他'];
const OCCASIONS = [
  '婚礼',
  '生日',
  '满月',
  '乔迁',
  '升学',
  '节日',
  '丧事',
  '探病',
  '其他',
];

export default function SocialGiftsPage() {
  const { addToast } = useToast();

  const [gifts, setGifts] = useState<SocialGift[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [filterType, setFilterType] = useState<string>('all');
  const [searchText, setSearchText] = useState('');

  const [summaryData, setSummaryData] = useState<SocialSummary[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGift, setEditingGift] = useState<SocialGift | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [submitting, setSubmitting] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const socialGiftsRev = useDataStore((s) => s.socialGiftsRev);

  const fetchGifts = useCallback(async () => {
    setLoading(true);
    try {
      const filters: Record<string, unknown> = {
        page,
        per_page: PER_PAGE,
      };
      if (filterType !== 'all') filters.type = filterType;
      const res = await socialGiftsService.list(filters);
      setGifts(res.data);
      setTotal(res.total);
    } catch {
      addToast({ title: '加载人情记录失败', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [page, filterType, addToast, socialGiftsRev]);

  useEffect(() => {
    fetchGifts();
  }, [fetchGifts]);

  useEffect(() => {
    const year = dayjs().year();
    statsService
      .socialSummary({ year })
      .then(setSummaryData)
      .catch(() => {});
  }, [socialGiftsRev]);

  const { totalGiven, totalReceived, netBalance } = useMemo(() => {
    let given = 0;
    let received = 0;
    for (const s of summaryData) {
      given += parseFloat(s.given) || 0;
      received += parseFloat(s.received) || 0;
    }
    return {
      totalGiven: given,
      totalReceived: received,
      netBalance: received - given,
    };
  }, [summaryData]);

  const filteredGifts = useMemo(() => {
    if (!searchText.trim()) return gifts;
    const q = searchText.toLowerCase();
    return gifts.filter((g) => g.person_name.toLowerCase().includes(q));
  }, [gifts, searchText]);

  const totalPages = Math.ceil(total / PER_PAGE);

  function openAddDialog() {
    setEditingGift(null);
    // Default to the last date the user picked (persisted), not always today.
    setForm({
      ...defaultForm,
      date: loadPersisted(LAST_GIFT_DATE_KEY, defaultForm.date),
    });
    setDialogOpen(true);
  }

  function openEditDialog(gift: SocialGift) {
    setEditingGift(gift);
    setForm({
      type: gift.type,
      person_name: gift.person_name,
      relation: gift.relation ?? '',
      occasion: gift.occasion,
      amount: gift.amount,
      currency: gift.currency,
      date: gift.date,
      note: gift.note ?? '',
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!form.person_name.trim()) {
      addToast({ title: '请输入对方姓名', variant: 'destructive' });
      return;
    }
    if (!form.occasion.trim()) {
      addToast({ title: '请输入场合', variant: 'destructive' });
      return;
    }
    if (!form.amount || parseFloat(form.amount) <= 0) {
      addToast({ title: '请输入有效金额', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        type: form.type,
        person_name: form.person_name.trim(),
        relation: form.relation || null,
        occasion: form.occasion.trim(),
        amount: form.amount,
        currency: form.currency,
        date: form.date,
        note: form.note || null,
      };

      if (editingGift) {
        await socialGiftsService.update(editingGift.id, payload);
        addToast({ title: '记录已更新' });
      } else {
        await socialGiftsService.create(payload);
        addToast({ title: '记录已添加' });
      }

      // Remember this date so the next "add" defaults to it.
      savePersisted(LAST_GIFT_DATE_KEY, form.date);

      setDialogOpen(false);
      fetchGifts();
      const year = dayjs().year();
      statsService.socialSummary({ year }).then(setSummaryData);
      useDataStore.getState().invalidateSocialGifts();
    } catch {
      addToast({ title: '操作失败', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deletingId) return;
    try {
      await socialGiftsService.deleteSocialGift(deletingId);
      addToast({ title: '记录已删除' });
      setDeleteDialogOpen(false);
      setDeletingId(null);
      fetchGifts();
      const year = dayjs().year();
      statsService.socialSummary({ year }).then(setSummaryData);
      useDataStore.getState().invalidateSocialGifts();
    } catch {
      addToast({ title: '删除失败', variant: 'destructive' });
    }
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">人情往来</h1>
        <Button onClick={openAddDialog}>
          <Plus className="size-4" />
          添加记录
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-expense/10 rounded-xl">
                <ArrowUpRight className="size-5 text-expense" />
              </div>
              <span className="text-sm text-muted-foreground">
                {dayjs().year()}年 送出
              </span>
            </div>
            <p className="text-2xl font-bold text-expense">
              {formatCurrency(totalGiven, 'CNY')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-income/10 rounded-xl">
                <ArrowDownLeft className="size-5 text-income" />
              </div>
              <span className="text-sm text-muted-foreground">
                {dayjs().year()}年 收到
              </span>
            </div>
            <p className="text-2xl font-bold text-income">
              {formatCurrency(totalReceived, 'CNY')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-primary/10 rounded-xl">
                <Scale className="size-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">净余额</span>
            </div>
            <p
              className={cn(
                'text-2xl font-bold',
                netBalance >= 0 ? 'text-income' : 'text-expense',
              )}
            >
              {netBalance >= 0 ? '+' : ''}
              {formatCurrency(netBalance, 'CNY')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <Tabs
          value={filterType}
          onValueChange={(v) => {
            setFilterType(v);
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="give">送出</TabsTrigger>
            <TabsTrigger value="receive">收到</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索姓名..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Gift List */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredGifts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16">
            <Gift className="h-14 w-14 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground text-sm mb-3">
              暂无人情记录
            </p>
            <Button variant="outline" size="sm" onClick={openAddDialog}>
              <Plus className="size-4" />
              添加记录
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredGifts.map((gift) => (
            <Card
              key={gift.id}
              className="hover:shadow-md transition-shadow"
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      'p-2.5 rounded-xl shrink-0',
                      gift.type === 'give'
                        ? 'bg-expense/10'
                        : 'bg-income/10',
                    )}
                  >
                    {gift.type === 'give' ? (
                      <ArrowUpRight className="size-5 text-expense" />
                    ) : (
                      <ArrowDownLeft className="size-5 text-income" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold truncate">
                        {gift.person_name}
                      </p>
                      {gift.relation && (
                        <Badge
                          variant="secondary"
                          className="text-xs shrink-0"
                        >
                          {gift.relation}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{gift.occasion}</span>
                      <span>·</span>
                      <span>{formatDate(gift.date)}</span>
                      {gift.note && (
                        <>
                          <span>·</span>
                          <span className="truncate">{gift.note}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <span
                    className={cn(
                      'text-sm font-semibold tabular-nums whitespace-nowrap',
                      gift.type === 'give'
                        ? 'text-expense'
                        : 'text-income',
                    )}
                  >
                    {gift.type === 'give' ? '-' : '+'}
                    {formatCurrency(gift.amount, gift.currency)}
                  </span>

                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => openEditDialog(gift)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => {
                        setDeletingId(gift.id);
                        setDeleteDialogOpen(true);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
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
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {editingGift ? '编辑人情记录' : '添加人情记录'}
            </DialogTitle>
            <DialogDescription>
              记录人情往来，方便日后查阅
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {/* Type Toggle */}
            <div className="flex rounded-lg border p-1 gap-1">
              <button
                type="button"
                className={cn(
                  'flex-1 py-2 rounded-md text-sm font-medium transition-all cursor-pointer',
                  form.type === 'give'
                    ? 'bg-expense text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => updateForm('type', 'give')}
              >
                送出
              </button>
              <button
                type="button"
                className={cn(
                  'flex-1 py-2 rounded-md text-sm font-medium transition-all cursor-pointer',
                  form.type === 'receive'
                    ? 'bg-income text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => updateForm('type', 'receive')}
              >
                收到
              </button>
            </div>

            {/* Person Name */}
            <div>
              <Label>对方姓名</Label>
              <Input
                placeholder="输入姓名"
                value={form.person_name}
                onChange={(e) =>
                  updateForm('person_name', e.target.value)
                }
                className="mt-1.5"
              />
            </div>

            {/* Relation */}
            <div>
              <Label>关系</Label>
              <Select
                value={form.relation}
                onValueChange={(v) => updateForm('relation', v)}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="选择关系（可选）" />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Occasion */}
            <div>
              <Label>场合</Label>
              <Select
                value={form.occasion}
                onValueChange={(v) => updateForm('occasion', v)}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="选择场合" />
                </SelectTrigger>
                <SelectContent>
                  {OCCASIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Date */}
            <div>
              <Label>日期</Label>
              <DatePicker
                value={form.date}
                onChange={(v) => updateForm('date', v)}
                className="mt-1.5"
              />
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
              {editingGift ? '保存' : '添加'}
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
              此操作不可撤销，确定要删除这条人情记录吗？
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
