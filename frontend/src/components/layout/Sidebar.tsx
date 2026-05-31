import { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router';
import {
  Home,
  Receipt,
  FolderOpen,
  BarChart3,
  LogOut,
  Wallet,
  X,
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
  ChevronRight,
  Camera,
  Settings,
} from 'lucide-react';

import { cn } from '@/utils/cn';
import { useAuthStore } from '@/stores/authStore';
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
import * as aiService from '@/services/ai';
import * as membersService from '@/services/members';
import { updateProfile } from '@/services/auth';
import type { LlmConfig, Member } from '@/types';
import { useToast } from '@/hooks/useToast';

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/transactions', label: '交易记录', icon: Receipt },
  { to: '/categories', label: '分类管理', icon: FolderOpen },
  { to: '/statistics', label: '统计分析', icon: BarChart3 },
  { to: '/settings', label: '设置', icon: Settings },
];

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

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  const { user, logout, login: authLogin } = useAuthStore();
  const { addToast } = useToast();

  const [profileOpen, setProfileOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [profileEditing, setProfileEditing] = useState(false);
  const [profileUsername, setProfileUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  const [llmConfig, setLlmConfig] = useState<LlmConfig | null>(null);
  const [llmForm, setLlmForm] = useState<LlmForm>(defaultLlmForm);
  const [llmEditing, setLlmEditing] = useState(false);
  const [llmSaving, setLlmSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [memberName, setMemberName] = useState('');
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingMember, setDeletingMember] = useState<Member | null>(null);

  useEffect(() => {
    if (!profileOpen) return;
    setLoadingConfig(true);
    setLoadingMembers(true);

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
  }, [profileOpen]);

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
    setTesting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let gotResponse = false;
    try {
      await aiService.chat(
        '你好',
        {
          onDelta: () => { gotResponse = true; },
          onError: (err) => {
            addToast({ title: '连接失败', description: err.message, variant: 'destructive' });
          },
          onDone: () => {
            if (gotResponse) addToast({ title: '连接成功', description: 'LLM 服务响应正常' });
          },
        },
        controller.signal,
      );
    } catch {
      addToast({ title: '连接测试失败', description: '请检查配置是否正确', variant: 'destructive' });
    } finally {
      clearTimeout(timeout);
      setTesting(false);
    }
  }

  async function handleMemberSubmit() {
    if (!memberName.trim()) {
      addToast({ title: '请输入成员姓名', variant: 'destructive' });
      return;
    }
    setMemberSubmitting(true);
    try {
      if (editingMember) {
        await membersService.update(editingMember.id, { name: memberName.trim() });
        addToast({ title: '成员已更新' });
      } else {
        await membersService.create({ name: memberName.trim() });
        addToast({ title: '成员已添加' });
      }
      setMemberDialogOpen(false);
      setMembers(await membersService.list());
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
      setMembers(await membersService.list());
    } catch {
      addToast({ title: '删除失败', variant: 'destructive' });
    }
  }

  async function handleProfileSave() {
    if (!user) return;
    if (!profileUsername.trim()) {
      addToast({ title: '用户名不能为空', variant: 'destructive' });
      return;
    }
    if (newPassword && newPassword.length < 4) {
      addToast({ title: '新密码至少4个字符', variant: 'destructive' });
      return;
    }
    if (newPassword && newPassword !== confirmNewPassword) {
      addToast({ title: '两次密码不一致', variant: 'destructive' });
      return;
    }
    if (newPassword && !currentPassword) {
      addToast({ title: '请输入当前密码', variant: 'destructive' });
      return;
    }
    const payload: Record<string, string> = {};
    if (profileUsername.trim() !== user.username) {
      payload.username = profileUsername.trim();
    }
    if (newPassword) {
      payload.current_password = currentPassword;
      payload.new_password = newPassword;
    }
    if (Object.keys(payload).length === 0) {
      setProfileEditing(false);
      return;
    }
    setProfileSaving(true);
    try {
      const resp = await updateProfile(payload);
      authLogin(resp.token, resp.user);
      setProfileEditing(false);
      addToast({ title: '个人信息已更新' });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '更新失败';
      addToast({ title: msg, variant: 'destructive' });
    } finally {
      setProfileSaving(false);
    }
  }

  function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast({ title: '请选择图片文件', variant: 'destructive' });
      return;
    }
    setAvatarUploading(true);
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const size = 200;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(img.src);
      try {
        const resp = await updateProfile({ avatar_url: dataUrl });
        authLogin(resp.token, resp.user);
        addToast({ title: '头像已更新' });
      } catch {
        addToast({ title: '头像更新失败', variant: 'destructive' });
      } finally {
        setAvatarUploading(false);
      }
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ease-in-out lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-5">
          <NavLink to="/" className="flex items-center gap-2.5 group" onClick={onClose}>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/25 transition-transform group-hover:scale-105">
              <Wallet className="size-5" />
            </div>
            <span className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
              PenyCounts
            </span>
          </NavLink>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 lg:hidden text-sidebar-foreground"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const isActive =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to);

            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={cn(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-200',
                  isActive
                    ? 'bg-primary/10 text-primary border border-sidebar-border'
                    : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary" />
                )}
                <item.icon
                  className={cn(
                    'h-[18px] w-[18px] shrink-0 transition-colors',
                    isActive
                      ? 'text-primary'
                      : 'text-sidebar-foreground/40 group-hover:text-sidebar-foreground/70',
                  )}
                />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-sidebar-accent/60 transition-all duration-200 cursor-pointer group"
          >
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt="头像"
                className="size-9 shrink-0 rounded-full object-cover ring-1 ring-primary/10 group-hover:ring-primary/20 transition-all"
              />
            ) : (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5 text-primary font-bold text-sm ring-1 ring-primary/10 group-hover:ring-primary/20 transition-all">
                {user?.nickname?.charAt(0)?.toUpperCase() ?? 'U'}
              </div>
            )}
            <div className="flex-1 min-w-0 text-left">
              <p className="truncate text-sm font-semibold text-sidebar-foreground">
                {user?.nickname ?? '用户'}
              </p>
              <p className="truncate text-xs text-sidebar-foreground/40">
                {user?.username ?? ''}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-sidebar-foreground/25 group-hover:text-sidebar-foreground/50 transition-colors" />
          </button>
        </div>
      </aside>

      {/* ── Profile Dialog ─────────────────────────────── */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>个人中心</DialogTitle>
            <DialogDescription>管理账户、AI 配置和家庭成员</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-6 py-2">
            {/* ─ Profile Info ─ */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-muted-foreground">账户信息</h3>
                {user && !profileEditing && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                    setProfileEditing(true);
                    setProfileUsername(user.username);
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmNewPassword('');
                  }}>
                    <Pencil className="size-3" />
                    编辑
                  </Button>
                )}
              </div>
              {user && !profileEditing && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="relative group cursor-pointer shrink-0"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={avatarUploading}
                    >
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt="头像"
                          className="size-12 rounded-full object-cover ring-2 ring-primary/10"
                        />
                      ) : (
                        <div className="size-12 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center text-lg font-bold text-primary ring-2 ring-primary/10">
                          {user.nickname?.charAt(0)?.toUpperCase() ?? 'U'}
                        </div>
                      )}
                      <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        {avatarUploading ? (
                          <Loader2 className="size-4 text-white animate-spin" />
                        ) : (
                          <Camera className="size-4 text-white" />
                        )}
                      </div>
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarSelect}
                    />
                    <div>
                      <p className="text-sm font-semibold">{user.nickname}</p>
                      <p className="text-xs text-muted-foreground">{user.username}</p>
                    </div>
                  </div>
                </div>
              )}
              {user && profileEditing && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3 mb-1">
                    <button
                      type="button"
                      className="relative group cursor-pointer shrink-0"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={avatarUploading}
                    >
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt="头像"
                          className="size-12 rounded-full object-cover ring-2 ring-primary/10"
                        />
                      ) : (
                        <div className="size-12 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center text-lg font-bold text-primary ring-2 ring-primary/10">
                          {user.nickname?.charAt(0)?.toUpperCase() ?? 'U'}
                        </div>
                      )}
                      <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        {avatarUploading ? (
                          <Loader2 className="size-4 text-white animate-spin" />
                        ) : (
                          <Camera className="size-4 text-white" />
                        )}
                      </div>
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarSelect}
                    />
                    <span className="text-xs text-muted-foreground">点击头像更换</span>
                  </div>
                  <div>
                    <Label className="text-xs">用户名</Label>
                    <Input value={profileUsername} onChange={(e) => setProfileUsername(e.target.value)} placeholder="输入新用户名" className="mt-1 h-9" />
                  </div>
                  <Separator />
                  <p className="text-xs text-muted-foreground">修改密码（不修改可留空）</p>
                  <div>
                    <Label className="text-xs">当前密码</Label>
                    <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="输入当前密码" className="mt-1 h-9" autoComplete="current-password" />
                  </div>
                  <div>
                    <Label className="text-xs">新密码</Label>
                    <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少4个字符" className="mt-1 h-9" autoComplete="new-password" />
                  </div>
                  <div>
                    <Label className="text-xs">确认新密码</Label>
                    <Input type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} placeholder="再次输入新密码" className="mt-1 h-9" autoComplete="new-password" />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" className="h-8" onClick={() => setProfileEditing(false)} disabled={profileSaving}>取消</Button>
                    <Button size="sm" className="h-8" onClick={handleProfileSave} disabled={profileSaving}>
                      {profileSaving && <Loader2 className="size-3 animate-spin" />}
                      保存
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* ─ LLM Config ─ */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-muted-foreground">AI 助手配置</h3>
                </div>
                {llmConfig && !llmEditing && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLlmEditing(true)}>
                    <Pencil className="size-3" />
                    编辑
                  </Button>
                )}
              </div>

              {loadingConfig ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : llmConfig && !llmEditing ? (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <Label className="text-muted-foreground text-xs">提供商</Label>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-medium">{llmConfig.provider}</span>
                        {llmConfig.is_active ? (
                          <Badge className="bg-income/15 text-income border-income/30 text-[10px] px-1.5 py-0">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />启用
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            <XCircle className="h-2.5 w-2.5 mr-0.5" />未启用
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs">模型</Label>
                      <p className="font-medium mt-0.5">{llmConfig.model_name || '-'}</p>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-muted-foreground text-xs">API 地址</Label>
                      <p className="font-mono text-xs mt-0.5 break-all">{llmConfig.api_url || '-'}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleTestConnection} disabled={testing || !llmConfig.api_url}>
                    {testing ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                    测试连接
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div>
                    <Label className="text-xs">提供商</Label>
                    <Select value={llmForm.provider} onValueChange={(v) => setLlmForm((f) => ({ ...f, provider: v }))}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="lm-studio">LM Studio</SelectItem>
                        <SelectItem value="custom">自定义</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">API 地址</Label>
                    <Input placeholder="http://localhost:1234/v1" value={llmForm.api_url} onChange={(e) => setLlmForm((f) => ({ ...f, api_url: e.target.value }))} className="mt-1 h-9 font-mono text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs">API Key</Label>
                    <div className="relative mt-1">
                      <Input type={showApiKey ? 'text' : 'password'} placeholder="可选" value={llmForm.api_key} onChange={(e) => setLlmForm((f) => ({ ...f, api_key: e.target.value }))} className="h-9 pr-9" />
                      <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => setShowApiKey(!showApiKey)}>
                        {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">模型名称</Label>
                    <Input placeholder="gpt-4o, llama-3" value={llmForm.model_name} onChange={(e) => setLlmForm((f) => ({ ...f, model_name: e.target.value }))} className="mt-1 h-9" />
                  </div>
                  <div className="flex gap-2">
                    {llmConfig && (
                      <Button variant="outline" size="sm" className="h-8" onClick={() => { setLlmEditing(false); setLlmForm({ provider: llmConfig.provider || 'openai', api_url: llmConfig.api_url || '', api_key: llmConfig.api_key || '', model_name: llmConfig.model_name || '' }); }} disabled={llmSaving}>
                        取消
                      </Button>
                    )}
                    <Button size="sm" className="h-8" onClick={handleSaveLlmConfig} disabled={llmSaving}>
                      {llmSaving && <Loader2 className="size-3 animate-spin" />}
                      保存
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* ─ Members ─ */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-muted-foreground">家庭成员</h3>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditingMember(null); setMemberName(''); setMemberDialogOpen(true); }}>
                  <Plus className="size-3" />
                  添加
                </Button>
              </div>

              {loadingMembers ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : members.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">暂未添加家庭成员</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {members.map((member) => (
                    <div key={member.id} className="flex items-center gap-2.5 py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                      <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                        {member.name.charAt(0)}
                      </div>
                      <span className="flex-1 text-sm font-medium">{member.name}</span>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => { setEditingMember(member); setMemberName(member.name); setMemberDialogOpen(true); }}>
                        <Pencil className="size-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => { setDeletingMember(member); setDeleteDialogOpen(true); }}>
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* ─ Logout ─ */}
            <Button variant="outline" className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30" onClick={logout}>
              <LogOut className="size-4" />
              退出登录
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Member Dialog ─────────────────────────────── */}
      <Dialog open={memberDialogOpen} onOpenChange={setMemberDialogOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>{editingMember ? '编辑成员' : '添加成员'}</DialogTitle>
            <DialogDescription>家庭成员名称将用于交易分摊</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label>姓名</Label>
            <Input placeholder="输入成员姓名" value={memberName} onChange={(e) => setMemberName(e.target.value)} className="mt-1.5" onKeyDown={(e) => { if (e.key === 'Enter') handleMemberSubmit(); }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberDialogOpen(false)} disabled={memberSubmitting}>取消</Button>
            <Button onClick={handleMemberSubmit} disabled={memberSubmitting}>
              {memberSubmitting && <Loader2 className="size-4 animate-spin" />}
              {editingMember ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Member Confirmation ────────────────── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>确定要删除成员"{deletingMember?.name}"吗？此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDeleteMember}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
