import { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  FolderOpen,
  Lock,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import * as categoriesService from '@/services/categories';
import { useDataStore } from '@/stores/dataStore';
import type { Category, Subcategory } from '@/types';
import { cn } from '@/utils/cn';
import { useToast } from '@/hooks/useToast';

const COMMON_ICONS = [
  '🍔', '🛒', '🏠', '🚗', '📱', '👕', '💊', '🎓',
  '✈️', '🎬', '💰', '📈', '🎁', '👶', '🐾', '💡',
  '🏥', '🚌', '☕', '🍜', '📚', '⚽', '🎵', '💼',
];

interface CategoryForm {
  name: string;
  icon: string;
}

export default function CategoriesPage() {
  const { addToast } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [catDialogType, setCatDialogType] = useState<'income' | 'expense'>(
    'expense',
  );
  const [catForm, setCatForm] = useState<CategoryForm>({
    name: '',
    icon: '📝',
  });

  const [subDialogOpen, setSubDialogOpen] = useState(false);
  const [parentCategoryId, setParentCategoryId] = useState<string>('');
  const [editingSubcategory, setEditingSubcategory] =
    useState<Subcategory | null>(null);
  const [subForm, setSubForm] = useState<CategoryForm>({
    name: '',
    icon: '📝',
  });

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<{
    type: 'category' | 'subcategory';
    id: string;
    parentId?: string;
    name: string;
  } | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const fetchCategories = async () => {
    try {
      const data = await categoriesService.getAll();
      setCategories(data);
    } catch {
      addToast({ title: '加载分类失败', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'expense'),
    [categories],
  );
  const incomeCategories = useMemo(
    () => categories.filter((c) => c.type === 'income'),
    [categories],
  );

  const isSystemCategory = (cat: Category | Subcategory) =>
    !('type' in cat) ? !(cat as Subcategory).user_id : !(cat as Category).user_id;

  function openAddCategory(type: 'income' | 'expense') {
    setEditingCategory(null);
    setCatDialogType(type);
    setCatForm({ name: '', icon: '📝' });
    setCatDialogOpen(true);
  }

  function openEditCategory(cat: Category) {
    setEditingCategory(cat);
    setCatDialogType(cat.type);
    setCatForm({ name: cat.name, icon: cat.icon });
    setCatDialogOpen(true);
  }

  function openAddSubcategory(categoryId: string) {
    setEditingSubcategory(null);
    setParentCategoryId(categoryId);
    setSubForm({ name: '', icon: '📝' });
    setSubDialogOpen(true);
  }

  function openEditSubcategory(sub: Subcategory) {
    setEditingSubcategory(sub);
    setParentCategoryId(sub.category_id);
    setSubForm({ name: sub.name, icon: sub.icon });
    setSubDialogOpen(true);
  }

  async function handleCategorySubmit() {
    if (!catForm.name.trim()) {
      addToast({ title: '请输入分类名称', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      if (editingCategory) {
        await categoriesService.update(editingCategory.id, {
          name: catForm.name.trim(),
          icon: catForm.icon,
        });
        addToast({ title: '分类已更新' });
      } else {
        await categoriesService.create({
          name: catForm.name.trim(),
          type: catDialogType,
          icon: catForm.icon,
        });
        addToast({ title: '分类已添加' });
      }
      setCatDialogOpen(false);
      fetchCategories();
      useDataStore.getState().invalidateCategories();
    } catch {
      addToast({ title: '操作失败', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubcategorySubmit() {
    if (!subForm.name.trim()) {
      addToast({ title: '请输入子分类名称', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      if (editingSubcategory) {
        await categoriesService.updateSubcategory(
          parentCategoryId,
          editingSubcategory.id,
          { name: subForm.name.trim(), icon: subForm.icon },
        );
        addToast({ title: '子分类已更新' });
      } else {
        await categoriesService.createSubcategory(parentCategoryId, {
          name: subForm.name.trim(),
          icon: subForm.icon,
        });
        addToast({ title: '子分类已添加' });
      }
      setSubDialogOpen(false);
      fetchCategories();
      useDataStore.getState().invalidateCategories();
    } catch {
      addToast({ title: '操作失败', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deletingItem) return;
    setSubmitting(true);
    try {
      if (deletingItem.type === 'category') {
        await categoriesService.deleteCategory(deletingItem.id);
      } else {
        await categoriesService.deleteSubcategory(
          deletingItem.parentId!,
          deletingItem.id,
        );
      }
      addToast({ title: `"${deletingItem.name}" 已删除` });
      setDeleteDialogOpen(false);
      setDeletingItem(null);
      fetchCategories();
      useDataStore.getState().invalidateCategories();
    } catch {
      addToast({ title: '删除失败', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  function renderIconPicker(
    selected: string,
    onSelect: (icon: string) => void,
  ) {
    return (
      <div className="grid grid-cols-8 gap-1.5">
        {COMMON_ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            className={cn(
              'size-9 flex items-center justify-center rounded-lg text-lg transition-all cursor-pointer hover:scale-110',
              selected === icon
                ? 'bg-primary/15 ring-2 ring-primary'
                : 'bg-muted hover:bg-muted/80',
            )}
            onClick={() => onSelect(icon)}
          >
            {icon}
          </button>
        ))}
      </div>
    );
  }

  function renderCategoryList(cats: Category[], type: 'income' | 'expense') {
    if (cats.length === 0) {
      return (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <FolderOpen className="h-14 w-14 mb-4 opacity-40" />
          <p className="text-sm mb-3">
            暂无{type === 'income' ? '收入' : '支出'}分类
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openAddCategory(type)}
          >
            <Plus className="size-4" />
            添加分类
          </Button>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        {cats.map((cat) => {
          const isSystem = isSystemCategory(cat);
          const isExpanded = expandedId === cat.id;
          const subs = cat.subcategories ?? [];

          return (
            <Card
              key={cat.id}
              className={cn(isSystem && 'opacity-80')}
            >
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() =>
                  setExpandedId(isExpanded ? null : cat.id)
                }
              >
                <span className="text-2xl size-10 flex items-center justify-center rounded-xl bg-muted/60">
                  {cat.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate">
                      {cat.name}
                    </p>
                    {isSystem && (
                      <Lock className="size-3 text-muted-foreground" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {subs.length > 0
                      ? `${subs.length} 个子分类`
                      : '无子分类'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {!isSystem && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditCategory(cat);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingItem({
                            type: 'category',
                            id: cat.id,
                            name: cat.name,
                          });
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  {isExpanded ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t px-4 pb-4 pt-3 flex flex-col gap-2 animate-fade-in">
                  {subs.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">
                      暂无子分类
                    </p>
                  ) : (
                    subs.map((sub) => {
                      const isSubSystem = !sub.user_id;
                      return (
                        <div
                          key={sub.id}
                          className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/30"
                        >
                          <span className="text-base">{sub.icon}</span>
                          <span className="text-sm flex-1 truncate">
                            {sub.name}
                          </span>
                          {isSubSystem && (
                            <Lock className="size-3 text-muted-foreground" />
                          )}
                          {!isSubSystem && (
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => openEditSubcategory(sub)}
                              >
                                <Pencil className="size-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-destructive hover:text-destructive"
                                onClick={() => {
                                  setDeletingItem({
                                    type: 'subcategory',
                                    id: sub.id,
                                    parentId: cat.id,
                                    name: sub.name,
                                  });
                                  setDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="size-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => openAddSubcategory(cat.id)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加子分类
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight">分类管理</h1>

      <Tabs defaultValue="expense">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="expense">
            支出分类 ({expenseCategories.length})
          </TabsTrigger>
          <TabsTrigger value="income">
            收入分类 ({incomeCategories.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="expense">
          <div className="flex justify-end mb-3">
            <Button
              size="sm"
              onClick={() => openAddCategory('expense')}
            >
              <Plus className="size-4" />
              添加支出分类
            </Button>
          </div>
          {renderCategoryList(expenseCategories, 'expense')}
        </TabsContent>

        <TabsContent value="income">
          <div className="flex justify-end mb-3">
            <Button
              size="sm"
              onClick={() => openAddCategory('income')}
            >
              <Plus className="size-4" />
              添加收入分类
            </Button>
          </div>
          {renderCategoryList(incomeCategories, 'income')}
        </TabsContent>
      </Tabs>

      {/* Category Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? '编辑分类' : '添加分类'}
            </DialogTitle>
            <DialogDescription>
              {catDialogType === 'income' ? '收入' : '支出'}分类
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div>
              <Label>分类名称</Label>
              <Input
                placeholder="输入分类名称"
                value={catForm.name}
                onChange={(e) =>
                  setCatForm((f) => ({ ...f, name: e.target.value }))
                }
                className="mt-1.5"
              />
            </div>
            <div>
              <Label className="mb-2 block">图标</Label>
              {renderIconPicker(catForm.icon, (icon) =>
                setCatForm((f) => ({ ...f, icon })),
              )}
              <div className="mt-2">
                <Input
                  placeholder="或直接输入 emoji"
                  value={catForm.icon}
                  onChange={(e) =>
                    setCatForm((f) => ({ ...f, icon: e.target.value }))
                  }
                  className="text-center text-lg"
                  maxLength={4}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCatDialogOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button onClick={handleCategorySubmit} disabled={submitting}>
              {submitting && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {editingCategory ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Subcategory Dialog */}
      <Dialog open={subDialogOpen} onOpenChange={setSubDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {editingSubcategory ? '编辑子分类' : '添加子分类'}
            </DialogTitle>
            <DialogDescription>
              为上级分类添加子分类
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div>
              <Label>子分类名称</Label>
              <Input
                placeholder="输入子分类名称"
                value={subForm.name}
                onChange={(e) =>
                  setSubForm((f) => ({ ...f, name: e.target.value }))
                }
                className="mt-1.5"
              />
            </div>
            <div>
              <Label className="mb-2 block">图标</Label>
              {renderIconPicker(subForm.icon, (icon) =>
                setSubForm((f) => ({ ...f, icon })),
              )}
              <div className="mt-2">
                <Input
                  placeholder="或直接输入 emoji"
                  value={subForm.icon}
                  onChange={(e) =>
                    setSubForm((f) => ({ ...f, icon: e.target.value }))
                  }
                  className="text-center text-lg"
                  maxLength={4}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSubDialogOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button
              onClick={handleSubcategorySubmit}
              disabled={submitting}
            >
              {submitting && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {editingSubcategory ? '保存' : '添加'}
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
              确定要删除"{deletingItem?.name}
              "吗？此操作不可撤销。
              {deletingItem?.type === 'category' &&
                '关联的子分类也将被删除。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={submitting}
            >
              {submitting && (
                <Loader2 className="size-4 animate-spin" />
              )}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
