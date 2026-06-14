import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Target, Wallet, Loader2 } from 'lucide-react';
import * as budgetsService from '@/services/budgets';
import * as categoriesService from '@/services/categories';
import { useDataStore } from '@/stores/dataStore';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProgressRing } from '@/components/ui/progress-ring';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/utils/format';
import { cn } from '@/utils/cn';
import type {
  BudgetPeriod,
  BudgetWithSpent,
  Category,
  SavingsGoal,
} from '@/types';

const TOTAL_SENTINEL = '__total__';

function ringColor(ratio: number): string {
  if (ratio >= 1) return 'var(--expense)';
  if (ratio >= 0.8) return '#f59e0b';
  return 'var(--primary)';
}

// ── Budget form dialog ───────────────────────────────────────────────

function BudgetDialog({
  open,
  onOpenChange,
  editing,
  expenseCategories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: BudgetWithSpent | null;
  expenseCategories: Category[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [categoryId, setCategoryId] = useState<string>(TOTAL_SENTINEL);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategoryId(editing?.category_id ?? TOTAL_SENTINEL);
    setAmount(editing ? String(Number.parseFloat(editing.amount)) : '');
    setPeriod(editing?.period ?? 'monthly');
  }, [open, editing]);

  const handleSave = async () => {
    const value = Number.parseFloat(amount);
    if (!Number.isFinite(value) || value < 0) {
      toast({ title: '请输入有效的预算金额', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const req = {
        category_id: categoryId === TOTAL_SENTINEL ? null : categoryId,
        amount: value.toFixed(2),
        period,
      };
      if (editing) {
        await budgetsService.updateBudget(editing.id, req);
        toast({ title: '预算已更新', variant: 'success' });
      } else {
        await budgetsService.createBudget(req);
        toast({ title: '预算已创建', variant: 'success' });
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        '保存失败，请重试';
      toast({ title: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? '编辑预算' : '新建预算'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label>预算范围</Label>
            <Select value={categoryId} onValueChange={setCategoryId} disabled={!!editing}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TOTAL_SENTINEL}>全部支出（总预算）</SelectItem>
                {expenseCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>周期</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as BudgetPeriod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">每月</SelectItem>
                <SelectItem value="yearly">每年</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>预算金额</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Goal form dialog ─────────────────────────────────────────────────

const GOAL_ICONS = ['🎯', '🏠', '🚗', '✈️', '💻', '📱', '💍', '🎓', '🏖️', '🎁'];

function GoalDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: SavingsGoal | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('');
  const [deadline, setDeadline] = useState('');
  const [icon, setIcon] = useState('🎯');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setTarget(editing ? String(Number.parseFloat(editing.target_amount)) : '');
    setCurrent(editing ? String(Number.parseFloat(editing.current_amount)) : '');
    setDeadline(editing?.deadline ?? '');
    setIcon(editing?.icon ?? '🎯');
  }, [open, editing]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: '请输入目标名称', variant: 'destructive' });
      return;
    }
    const t = Number.parseFloat(target);
    if (!Number.isFinite(t) || t <= 0) {
      toast({ title: '请输入有效的目标金额', variant: 'destructive' });
      return;
    }
    const c = Number.parseFloat(current) || 0;
    setSaving(true);
    try {
      const req = {
        name: name.trim(),
        target_amount: t.toFixed(2),
        current_amount: Math.max(0, c).toFixed(2),
        deadline: deadline || null,
        icon,
      };
      if (editing) {
        await budgetsService.updateGoal(editing.id, req);
        toast({ title: '目标已更新', variant: 'success' });
      } else {
        await budgetsService.createGoal(req);
        toast({ title: '目标已创建', variant: 'success' });
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        '保存失败，请重试';
      toast({ title: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? '编辑目标' : '新建储蓄目标'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label>图标</Label>
            <div className="flex flex-wrap gap-2">
              {GOAL_ICONS.map((emo) => (
                <button
                  key={emo}
                  type="button"
                  onClick={() => setIcon(emo)}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-lg border text-lg transition-colors',
                    icon === emo
                      ? 'border-primary bg-primary/10'
                      : 'border-input hover:bg-accent',
                  )}
                >
                  {emo}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>目标名称</Label>
            <Input
              placeholder="例如：旅行基金"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>目标金额</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>已存金额</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>目标日期（可选）</Label>
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function BudgetsPage() {
  const { toast } = useToast();
  const invalidateBudgets = useDataStore((s) => s.invalidateBudgets);
  const invalidateGoals = useDataStore((s) => s.invalidateGoals);
  const budgetsRev = useDataStore((s) => s.budgetsRev);
  const goalsRev = useDataStore((s) => s.goalsRev);
  const transactionsRev = useDataStore((s) => s.transactionsRev);

  const [budgets, setBudgets] = useState<BudgetWithSpent[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetWithSpent | null>(null);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'expense'),
    [categories],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      budgetsService.listBudgets(),
      budgetsService.listGoals(),
      categoriesService.getAll(),
    ])
      .then(([b, g, c]) => {
        if (!alive) return;
        setBudgets(b);
        setGoals(g);
        setCategories(c);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [budgetsRev, goalsRev, transactionsRev]);

  const openCreateBudget = () => {
    setEditingBudget(null);
    setBudgetDialogOpen(true);
  };
  const openEditBudget = (b: BudgetWithSpent) => {
    setEditingBudget(b);
    setBudgetDialogOpen(true);
  };
  const removeBudget = async (b: BudgetWithSpent) => {
    if (!window.confirm('确定删除该预算？')) return;
    try {
      await budgetsService.deleteBudget(b.id);
      toast({ title: '预算已删除', variant: 'success' });
      invalidateBudgets();
    } catch {
      toast({ title: '删除失败', variant: 'destructive' });
    }
  };

  const openCreateGoal = () => {
    setEditingGoal(null);
    setGoalDialogOpen(true);
  };
  const openEditGoal = (g: SavingsGoal) => {
    setEditingGoal(g);
    setGoalDialogOpen(true);
  };
  const removeGoal = async (g: SavingsGoal) => {
    if (!window.confirm('确定删除该目标？')) return;
    try {
      await budgetsService.deleteGoal(g.id);
      toast({ title: '目标已删除', variant: 'success' });
      invalidateGoals();
    } catch {
      toast({ title: '删除失败', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-4 sm:p-6">
      {/* Budgets */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">预算</h1>
            <p className="text-sm text-muted-foreground">设定每月/每年的支出上限</p>
          </div>
          <Button size="sm" onClick={openCreateBudget}>
            <Plus className="size-4" />
            新建预算
          </Button>
        </div>

        {budgets.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="还没有预算"
            description="为分类或总支出设置一个上限，帮助你控制开销"
            action={
              <Button size="sm" variant="outline" onClick={openCreateBudget}>
                <Plus className="size-4" />
                创建第一个预算
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {budgets.map((b) => {
              const amount = Number.parseFloat(b.amount) || 0;
              const spent = Number.parseFloat(b.spent) || 0;
              const ratio = amount > 0 ? spent / amount : 0;
              const remaining = amount - spent;
              const over = remaining < 0;
              return (
                <div key={b.id} className="glass group relative flex items-center gap-4 rounded-xl p-4">
                  <ProgressRing progress={ratio} color={ringColor(ratio)} size={88} stroke={8}>
                    <span className="text-sm font-bold tabular-nums">{Math.round(ratio * 100)}%</span>
                    <span className="text-[10px] text-muted-foreground">
                      {b.period === 'monthly' ? '本月' : '本年'}
                    </span>
                  </ProgressRing>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      {b.category_id
                        ? `${b.category_icon ?? ''} ${b.category_name ?? '分类'}`
                        : '总支出'}
                    </p>
                    <p className="mt-1 text-sm tabular-nums">
                      {formatCurrency(spent, 'CNY')}
                      <span className="text-muted-foreground"> / {formatCurrency(amount, 'CNY')}</span>
                    </p>
                    <p
                      className={cn(
                        'mt-0.5 text-xs tabular-nums',
                        over ? 'text-expense' : 'text-muted-foreground',
                      )}
                    >
                      {over
                        ? `超支 ${formatCurrency(-remaining, 'CNY')}`
                        : `剩余 ${formatCurrency(remaining, 'CNY')}`}
                    </p>
                  </div>
                  <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button size="icon" variant="ghost" className="size-7" onClick={() => openEditBudget(b)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-expense"
                      onClick={() => removeBudget(b)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Savings goals */}
      <section className="flex flex-col gap-4 border-t pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">储蓄目标</h1>
            <p className="text-sm text-muted-foreground">为心愿攒钱，看着进度一点点涨</p>
          </div>
          <Button size="sm" onClick={openCreateGoal}>
            <Plus className="size-4" />
            新建目标
          </Button>
        </div>

        {goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title="还没有储蓄目标"
            description="设定一个心愿，比如旅行基金或新手机"
            action={
              <Button size="sm" variant="outline" onClick={openCreateGoal}>
                <Plus className="size-4" />
                创建第一个目标
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {goals.map((g) => {
              const target = Number.parseFloat(g.target_amount) || 0;
              const current = Number.parseFloat(g.current_amount) || 0;
              const ratio = target > 0 ? Math.min(1, current / target) : 0;
              const done = current >= target;
              return (
                <div key={g.id} className="glass group relative flex flex-col gap-3 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-xl">
                      {g.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{g.name}</p>
                      {g.deadline ? (
                        <p className="text-xs text-muted-foreground">目标日期 {g.deadline}</p>
                      ) : null}
                    </div>
                    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => openEditGoal(g)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-expense"
                        onClick={() => removeGoal(g)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted/50">
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-700 ease-out',
                        done ? 'bg-income' : 'bg-gradient-to-r from-primary/70 to-primary',
                      )}
                      style={{ width: `${ratio * 100}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="tabular-nums">
                      {formatCurrency(current, 'CNY')}
                      <span className="text-muted-foreground"> / {formatCurrency(target, 'CNY')}</span>
                    </span>
                    <span className={cn('font-semibold tabular-nums', done ? 'text-income' : 'text-primary')}>
                      {done ? '已达成 🎉' : `${Math.round(ratio * 100)}%`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <BudgetDialog
        open={budgetDialogOpen}
        onOpenChange={setBudgetDialogOpen}
        editing={editingBudget}
        expenseCategories={expenseCategories}
        onSaved={invalidateBudgets}
      />
      <GoalDialog
        open={goalDialogOpen}
        onOpenChange={setGoalDialogOpen}
        editing={editingGoal}
        onSaved={invalidateGoals}
      />
    </div>
  );
}
