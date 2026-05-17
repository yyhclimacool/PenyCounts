import { useState, useEffect } from 'react';
import {
  Settings,
  User,
  Bot,
  Users,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import { useAuthStore } from '@/stores/authStore';
import * as aiService from '@/services/ai';
import * as membersService from '@/services/members';
import type { LlmConfig, Member } from '@/types';
import { cn } from '@/utils/cn';
import { useToast } from '@/hooks/useToast';

interface LlmForm {
  provider: string;
  api_url: string;
  api_key: string;
  model_name: string;
}

const defaultLlmForm: LlmForm = {
  provider: 'openai',
  api_url: '',
  api_key: '',
  model_name: '',
};

export default function SettingsPage() {
  const { addToast } = useToast();
  const user = useAuthStore((s) => s.user);

  const [llmConfig, setLlmConfig] = useState<LlmConfig | null>(null);
  const [llmForm, setLlmForm] = useState<LlmForm>(defaultLlmForm);
  const [llmEditing, setLlmEditing] = useState(false);
  const [llmSaving, setLlmSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [memberName, setMemberName] = useState('');
  const [memberSubmitting, setMemberSubmitting] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingMember, setDeletingMember] = useState<Member | null>(null);

  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);

  useEffect(() => {
    aiService
      .getConfig()
      .then((config) => {
        setLlmConfig(config);
        setLlmForm({
          provider: config.provider || 'openai',
          api_url: config.api_url || '',
          api_key: config.api_key || '',
          model_name: config.model_name || '',
        });
      })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));

    membersService
      .list()
      .then(setMembers)
      .catch(() => {})
      .finally(() => setLoadingMembers(false));
  }, []);

  async function handleSaveLlmConfig() {
    if (!llmForm.api_url.trim()) {
      addToast({ title: '请输入 API 地址', variant: 'destructive' });
      return;
    }
    if (!llmForm.model_name.trim()) {
      addToast({ title: '请输入模型名称', variant: 'destructive' });
      return;
    }

    setLlmSaving(true);
    try {
      const saved = await aiService.saveConfig({
        provider: llmForm.provider,
        api_url: llmForm.api_url.trim(),
        api_key: llmForm.api_key || null,
        model_name: llmForm.model_name.trim(),
        is_active: true,
      });
      setLlmConfig(saved);
      setLlmEditing(false);
      addToast({ title: 'LLM 配置已保存' });
    } catch {
      addToast({ title: '保存失败', variant: 'destructive' });
    } finally {
      setLlmSaving(false);
    }
  }

  async function handleTestConnection() {
    const url = llmConfig?.api_url || llmForm.api_url;
    const key = llmConfig?.api_key || llmForm.api_key;
    const model = llmConfig?.model_name || llmForm.model_name;

    if (!url.trim()) {
      addToast({ title: '请先填写 API 地址', variant: 'destructive' });
      return;
    }
    if (!model.trim()) {
      addToast({ title: '请先填写模型名称', variant: 'destructive' });
      return;
    }

    setTesting(true);
    try {
      const result = await aiService.testConnection({
        api_url: url.trim(),
        api_key: key || null,
        model_name: model.trim(),
      });
      if (result.success) {
        addToast({
          title: '连接成功',
          description: `模型已响应: "${result.reply}"`,
        });
      } else {
        addToast({
          title: '连接失败',
          description: result.error || '未知错误',
          variant: 'destructive',
        });
      }
    } catch {
      addToast({
        title: '测试请求失败',
        description: '请检查网络或后端服务是否正常',
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
    }
  }

  function openAddMember() {
    setEditingMember(null);
    setMemberName('');
    setMemberDialogOpen(true);
  }

  function openEditMember(member: Member) {
    setEditingMember(member);
    setMemberName(member.name);
    setMemberDialogOpen(true);
  }

  async function handleMemberSubmit() {
    if (!memberName.trim()) {
      addToast({ title: '请输入成员姓名', variant: 'destructive' });
      return;
    }
    setMemberSubmitting(true);
    try {
      if (editingMember) {
        await membersService.update(editingMember.id, {
          name: memberName.trim(),
        });
        addToast({ title: '成员已更新' });
      } else {
        await membersService.create({ name: memberName.trim() });
        addToast({ title: '成员已添加' });
      }
      setMemberDialogOpen(false);
      const updated = await membersService.list();
      setMembers(updated);
    } catch {
      addToast({ title: '操作失败', variant: 'destructive' });
    } finally {
      setMemberSubmitting(false);
    }
  }

  async function handleDeleteMember() {
    if (!deletingMember) return;
    try {
      await membersService.deleteMember(deletingMember.id);
      addToast({ title: `"${deletingMember.name}" 已删除` });
      setDeleteDialogOpen(false);
      setDeletingMember(null);
      const updated = await membersService.list();
      setMembers(updated);
    } catch {
      addToast({ title: '删除失败', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-8 p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <User className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">个人中心</h1>
      </div>

      {/* Profile Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>个人信息</CardTitle>
              <CardDescription>您的账户信息</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {user ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">用户名</Label>
                <p className="text-sm font-medium mt-1">{user.username}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">昵称</Label>
                <p className="text-sm font-medium mt-1">{user.nickname}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">未登录</p>
          )}
        </CardContent>
      </Card>

      {/* LLM Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>LLM 配置</CardTitle>
                <CardDescription>配置 AI 助手连接</CardDescription>
              </div>
            </div>
            {llmConfig && !llmEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLlmEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
                编辑
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingConfig ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : llmConfig && !llmEditing ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">提供商</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-sm font-medium">
                      {llmConfig.provider}
                    </p>
                    {llmConfig.is_active ? (
                      <Badge className="bg-income/15 text-income border-income/30 text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        已启用
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        <XCircle className="h-3 w-3 mr-1" />
                        未启用
                      </Badge>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">模型名称</Label>
                  <p className="text-sm font-medium mt-1">
                    {llmConfig.model_name || '-'}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-muted-foreground">
                    API 地址
                  </Label>
                  <p className="text-sm font-medium mt-1 font-mono text-xs break-all">
                    {llmConfig.api_url || '-'}
                  </p>
                </div>
              </div>
              <Separator />
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing || !llmConfig.api_url}
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                测试连接
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label>提供商</Label>
                <Select
                  value={llmForm.provider}
                  onValueChange={(v) =>
                    setLlmForm((f) => ({ ...f, provider: v }))
                  }
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="lm-studio">LM Studio</SelectItem>
                    <SelectItem value="custom">自定义</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>API 地址</Label>
                <Input
                  placeholder="例如: http://localhost:1234/v1"
                  value={llmForm.api_url}
                  onChange={(e) =>
                    setLlmForm((f) => ({
                      ...f,
                      api_url: e.target.value,
                    }))
                  }
                  className="mt-1.5 font-mono text-sm"
                />
              </div>
              <div>
                <Label>API Key</Label>
                <div className="relative mt-1.5">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="输入 API Key（可选）"
                    value={llmForm.api_key}
                    onChange={(e) =>
                      setLlmForm((f) => ({
                        ...f,
                        api_key: e.target.value,
                      }))
                    }
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <Label>模型名称</Label>
                <Input
                  placeholder="例如: gpt-4o, llama-3"
                  value={llmForm.model_name}
                  onChange={(e) =>
                    setLlmForm((f) => ({
                      ...f,
                      model_name: e.target.value,
                    }))
                  }
                  className="mt-1.5"
                />
              </div>
              <div className="flex gap-2 pt-2">
                {llmConfig && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setLlmEditing(false);
                      setLlmForm({
                        provider: llmConfig.provider || 'openai',
                        api_url: llmConfig.api_url || '',
                        api_key: llmConfig.api_key || '',
                        model_name: llmConfig.model_name || '',
                      });
                    }}
                    disabled={llmSaving}
                  >
                    取消
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={testing || !llmForm.api_url.trim() || !llmForm.model_name.trim()}
                >
                  {testing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  测试
                </Button>
                <Button
                  onClick={handleSaveLlmConfig}
                  disabled={llmSaving}
                >
                  {llmSaving && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  保存配置
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>家庭成员</CardTitle>
                <CardDescription>
                  管理在交易中使用的家庭成员名称
                </CardDescription>
              </div>
            </div>
            <Button size="sm" onClick={openAddMember}>
              <Plus className="h-4 w-4" />
              添加
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingMembers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-muted-foreground">
              <Users className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm mb-3">暂未添加家庭成员</p>
              <Button variant="outline" size="sm" onClick={openAddMember}>
                <Plus className="h-4 w-4" />
                添加成员
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-3 py-3 px-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                    {member.name.charAt(0)}
                  </div>
                  <span className="flex-1 text-sm font-medium">
                    {member.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEditMember(member)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => {
                      setDeletingMember(member);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Member Dialog */}
      <Dialog open={memberDialogOpen} onOpenChange={setMemberDialogOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>
              {editingMember ? '编辑成员' : '添加成员'}
            </DialogTitle>
            <DialogDescription>
              家庭成员名称将用于交易分摊
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label>姓名</Label>
            <Input
              placeholder="输入成员姓名"
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              className="mt-1.5"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleMemberSubmit();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMemberDialogOpen(false)}
              disabled={memberSubmitting}
            >
              取消
            </Button>
            <Button
              onClick={handleMemberSubmit}
              disabled={memberSubmitting}
            >
              {memberSubmitting && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {editingMember ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Member Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除成员"{deletingMember?.name}
              "吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              取消
            </Button>
            <Button variant="destructive" onClick={handleDeleteMember}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
