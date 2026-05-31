import { useState, useEffect, useRef } from 'react';
import {
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
  Camera,
  Home,
  Copy,
  LogOut,
  RefreshCw,
  Crown,
  AlertTriangle,
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
import { useDataStore } from '@/stores/dataStore';
import * as aiService from '@/services/ai';
import * as membersService from '@/services/members';
import * as familyService from '@/services/family';
import { clearAllTransactions } from '@/services/transactions';
import { updateProfile } from '@/services/auth';
import type { LlmConfig, Member, Family, FamilyDetail } from '@/types';
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
  const setUser = useAuthStore((s) => s.setUser);
  const authLogin = useAuthStore((s) => s.login);

  const [profileEditing, setProfileEditing] = useState(false);
  const [profileUsername, setProfileUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const [clearTxnDialogOpen, setClearTxnDialogOpen] = useState(false);
  const [clearTxnConfirmText, setClearTxnConfirmText] = useState('');
  const [clearingTxns, setClearingTxns] = useState(false);

  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);

  // Family state
  const [families, setFamilies] = useState<Family[]>([]);
  const [loadingFamilies, setLoadingFamilies] = useState(true);
  const [createFamilyOpen, setCreateFamilyOpen] = useState(false);
  const [joinFamilyOpen, setJoinFamilyOpen] = useState(false);
  const [familyDetailOpen, setFamilyDetailOpen] = useState(false);
  const [familyDetail, setFamilyDetail] = useState<FamilyDetail | null>(null);
  const [newFamilyName, setNewFamilyName] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [familySubmitting, setFamilySubmitting] = useState(false);

  useEffect(() => {
    familyService
      .listFamilies()
      .then(setFamilies)
      .catch(() => {})
      .finally(() => setLoadingFamilies(false));
  }, []);

  async function handleCreateFamily() {
    if (!newFamilyName.trim()) {
      addToast({ title: '请输入家庭名称', variant: 'destructive' });
      return;
    }
    setFamilySubmitting(true);
    try {
      await familyService.createFamily(newFamilyName.trim());
      setCreateFamilyOpen(false);
      setNewFamilyName('');
      setFamilies(await familyService.listFamilies());
      useDataStore.getState().invalidateFamilies();
      addToast({ title: '家庭创建成功' });
    } catch {
      addToast({ title: '创建失败', variant: 'destructive' });
    } finally {
      setFamilySubmitting(false);
    }
  }

  async function handleJoinFamily() {
    if (!inviteCodeInput.trim()) {
      addToast({ title: '请输入邀请码', variant: 'destructive' });
      return;
    }
    setFamilySubmitting(true);
    try {
      await familyService.joinFamily(inviteCodeInput.trim());
      setJoinFamilyOpen(false);
      setInviteCodeInput('');
      setFamilies(await familyService.listFamilies());
      useDataStore.getState().invalidateFamilies();
      addToast({ title: '加入成功' });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? '加入失败';
      addToast({ title: msg, variant: 'destructive' });
    } finally {
      setFamilySubmitting(false);
    }
  }

  async function handleSwitchFamily(familyId: string) {
    try {
      await familyService.switchDefaultFamily(familyId);
      addToast({ title: '已切换默认家庭' });
      window.location.reload();
    } catch {
      addToast({ title: '切换失败', variant: 'destructive' });
    }
  }

  async function handleLeaveFamily(familyId: string) {
    try {
      await familyService.leaveFamily(familyId);
      setFamilyDetailOpen(false);
      setFamilies(await familyService.listFamilies());
      useDataStore.getState().invalidateFamilies();
      addToast({ title: '已退出家庭' });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? '退出失败';
      addToast({ title: msg, variant: 'destructive' });
    }
  }

  const [deleteFamilyTarget, setDeleteFamilyTarget] = useState<Family | null>(null);

  async function handleDeleteFamily(familyId: string) {
    try {
      await familyService.deleteFamily(familyId);
      setDeleteFamilyTarget(null);
      setFamilies(await familyService.listFamilies());
      useDataStore.getState().invalidateFamilies();
      addToast({ title: '家庭已删除' });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? '删除失败';
      addToast({ title: msg, variant: 'destructive' });
    }
  }

  async function handleViewFamily(familyId: string) {
    try {
      const detail = await familyService.getFamilyDetail(familyId);
      setFamilyDetail(detail);
      setFamilyDetailOpen(true);
    } catch {
      addToast({ title: '加载失败', variant: 'destructive' });
    }
  }

  async function handleRegenerateCode(familyId: string) {
    try {
      const newCode = await familyService.regenerateInviteCode(familyId);
      setFamilyDetail((d) => d ? { ...d, invite_code: newCode } : d);
      setFamilies((fs) =>
        fs.map((f) => (f.id === familyId ? { ...f, invite_code: newCode } : f))
      );
      addToast({ title: '邀请码已更新' });
    } catch {
      addToast({ title: '更新失败', variant: 'destructive' });
    }
  }

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
      useDataStore.getState().invalidateMembers();
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
      useDataStore.getState().invalidateMembers();
    } catch {
      addToast({ title: '删除失败', variant: 'destructive' });
    }
  }

  async function handleClearAllTransactions() {
    if (clearTxnConfirmText !== '删除所有记录') return;
    setClearingTxns(true);
    try {
      const { deleted } = await clearAllTransactions();
      addToast({ title: `已清除 ${deleted} 条记账记录` });
      setClearTxnDialogOpen(false);
      setClearTxnConfirmText('');
      useDataStore.getState().invalidateTransactions();
    } catch {
      addToast({ title: '清除失败', variant: 'destructive' });
    } finally {
      setClearingTxns(false);
    }
  }

  function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast({ title: '请选择图片文件', variant: 'destructive' });
      return;
    }
    const img = new Image();
    img.onload = () => {
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
      setAvatarPreview(dataUrl);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  }

  return (
    <div className="flex flex-col gap-8 p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <User className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">个人中心</h1>
      </div>

      {/* Profile Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl">
                <User className="size-5 text-primary" />
              </div>
              <div>
                <CardTitle>个人信息</CardTitle>
                <CardDescription>管理您的账户信息</CardDescription>
              </div>
            </div>
            {user && !profileEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setProfileEditing(true);
                  setProfileUsername(user.username);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmNewPassword('');
                  setAvatarPreview(null);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                编辑
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!user ? (
            <p className="text-sm text-muted-foreground">未登录</p>
          ) : !profileEditing ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt="头像"
                    className="h-16 w-16 rounded-full object-cover ring-2 ring-primary/10"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center text-xl font-bold text-primary ring-2 ring-primary/10">
                    {user.nickname?.charAt(0)?.toUpperCase() ?? 'U'}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold">{user.nickname}</p>
                  <p className="text-xs text-muted-foreground">{user.username}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">用户名</Label>
                  <p className="text-sm font-medium mt-1">{user.username}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">密码</Label>
                  <p className="text-sm font-medium mt-1">••••••</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  className="relative group cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {(avatarPreview || user.avatar_url) ? (
                    <img
                      src={avatarPreview || user.avatar_url!}
                      alt="头像"
                      className="h-16 w-16 rounded-full object-cover ring-2 ring-primary/10"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center text-xl font-bold text-primary ring-2 ring-primary/10">
                      {user.nickname?.charAt(0)?.toUpperCase() ?? 'U'}
                    </div>
                  )}
                  <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="size-5 text-white" />
                  </div>
                </button>
                <div className="text-sm text-muted-foreground">
                  点击头像更换
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarSelect}
                />
              </div>
              <div>
                <Label>用户名</Label>
                <Input
                  value={profileUsername}
                  onChange={(e) => setProfileUsername(e.target.value)}
                  placeholder="输入新用户名"
                  className="mt-1.5"
                />
              </div>
              <Separator />
              <p className="text-sm text-muted-foreground">修改密码（不修改可留空）</p>
              <div>
                <Label>当前密码</Label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="输入当前密码"
                  className="mt-1.5"
                  autoComplete="current-password"
                />
              </div>
              <div>
                <Label>新密码</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少4个字符"
                  className="mt-1.5"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <Label>确认新密码</Label>
                <Input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="再次输入新密码"
                  className="mt-1.5"
                  autoComplete="new-password"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setProfileEditing(false)}
                  disabled={profileSaving}
                >
                  取消
                </Button>
                <Button
                  onClick={async () => {
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
                    setProfileSaving(true);
                    try {
                      const payload: Record<string, string> = {};
                      if (profileUsername.trim() !== user.username) {
                        payload.username = profileUsername.trim();
                      }
                      if (newPassword) {
                        payload.current_password = currentPassword;
                        payload.new_password = newPassword;
                      }
                      if (avatarPreview) {
                        payload.avatar_url = avatarPreview;
                      }
                      if (Object.keys(payload).length === 0) {
                        setProfileEditing(false);
                        return;
                      }
                      const resp = await updateProfile(payload);
                      authLogin(resp.token, resp.user);
                      setProfileEditing(false);
                      addToast({ title: '个人信息已更新' });
                    } catch (err: unknown) {
                      const msg =
                        (err as { response?: { data?: { error?: string } } })
                          ?.response?.data?.error ?? '更新失败';
                      addToast({ title: msg, variant: 'destructive' });
                    } finally {
                      setProfileSaving(false);
                    }
                  }}
                  disabled={profileSaving}
                >
                  {profileSaving && <Loader2 className="size-4 animate-spin" />}
                  保存
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Family Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl">
                <Home className="size-5 text-primary" />
              </div>
              <div>
                <CardTitle>家庭管理</CardTitle>
                <CardDescription>管理您的家庭，切换默认家庭</CardDescription>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setInviteCodeInput('');
                  setJoinFamilyOpen(true);
                }}
              >
                加入
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setNewFamilyName('');
                  setCreateFamilyOpen(true);
                }}
              >
                <Plus className="size-4" />
                创建
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingFamilies ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : families.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              暂无家庭
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {families.map((fam) => {
                const isDefault = fam.id === user?.default_family_id;
                return (
                  <div
                    key={fam.id}
                    className={cn(
                      'flex items-center gap-3 py-3 px-4 rounded-lg transition-colors cursor-pointer',
                      isDefault
                        ? 'bg-primary/5 ring-1 ring-primary/20'
                        : 'bg-muted/30 hover:bg-muted/50'
                    )}
                    onClick={() => handleViewFamily(fam.id)}
                  >
                    <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                      {fam.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {fam.name}
                        </span>
                        {isDefault && (
                          <Badge className="bg-primary/15 text-primary border-primary/30 text-xs">
                            默认
                          </Badge>
                        )}
                        {fam.role === 'owner' && (
                          <Crown className="h-3.5 w-3.5 text-amber-500" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {fam.member_count} 位成员
                      </p>
                    </div>
                    {!isDefault && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSwitchFamily(fam.id);
                          }}
                        >
                          设为默认
                        </Button>
                        {fam.role === 'owner' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteFamilyTarget(fam);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Family Dialog */}
      <Dialog open={createFamilyOpen} onOpenChange={setCreateFamilyOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>创建家庭</DialogTitle>
            <DialogDescription>创建一个新家庭，邀请成员共同记账</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label>家庭名称</Label>
            <Input
              placeholder="例如: 我的小家"
              value={newFamilyName}
              onChange={(e) => setNewFamilyName(e.target.value)}
              className="mt-1.5"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFamily();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateFamilyOpen(false)}
              disabled={familySubmitting}
            >
              取消
            </Button>
            <Button onClick={handleCreateFamily} disabled={familySubmitting}>
              {familySubmitting && <Loader2 className="size-4 animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Join Family Dialog */}
      <Dialog open={joinFamilyOpen} onOpenChange={setJoinFamilyOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>加入家庭</DialogTitle>
            <DialogDescription>输入邀请码加入已有家庭</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label>邀请码</Label>
            <Input
              placeholder="输入 8 位邀请码"
              value={inviteCodeInput}
              onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
              className="mt-1.5 font-mono tracking-wider"
              maxLength={8}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleJoinFamily();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setJoinFamilyOpen(false)}
              disabled={familySubmitting}
            >
              取消
            </Button>
            <Button onClick={handleJoinFamily} disabled={familySubmitting}>
              {familySubmitting && <Loader2 className="size-4 animate-spin" />}
              加入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Family Detail Dialog */}
      <Dialog open={familyDetailOpen} onOpenChange={setFamilyDetailOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{familyDetail?.name}</DialogTitle>
            <DialogDescription>家庭详情与成员</DialogDescription>
          </DialogHeader>
          {familyDetail && (
            <div className="flex flex-col gap-4 py-2">
              <div>
                <Label className="text-muted-foreground">邀请码</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-sm font-mono bg-muted px-3 py-1.5 rounded tracking-wider">
                    {familyDetail.invite_code}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => {
                      navigator.clipboard.writeText(familyDetail.invite_code);
                      addToast({ title: '已复制邀请码' });
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  {families.find((f) => f.id === familyDetail.id)?.role === 'owner' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => handleRegenerateCode(familyDetail.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <Separator />
              <div>
                <Label className="text-muted-foreground">成员</Label>
                <div className="flex flex-col gap-2 mt-2">
                  {familyDetail.members.map((m) => (
                    <div
                      key={m.user_id}
                      className="flex items-center gap-3 py-2"
                    >
                      {m.avatar_url ? (
                        <img
                          src={m.avatar_url}
                          alt=""
                          className="size-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                          {m.nickname.charAt(0)}
                        </div>
                      )}
                      <span className="text-sm flex-1">{m.nickname}</span>
                      {m.role === 'owner' && (
                        <Badge variant="secondary" className="text-xs">
                          <Crown className="size-3 mr-1" />
                          创建者
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {families.find((f) => f.id === familyDetail.id)?.role !== 'owner' && (
                <>
                  <Separator />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleLeaveFamily(familyDetail.id)}
                  >
                    <LogOut className="size-4" />
                    退出家庭
                  </Button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Family Confirm Dialog */}
      <Dialog open={!!deleteFamilyTarget} onOpenChange={() => setDeleteFamilyTarget(null)}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>删除家庭</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteFamilyTarget?.name}」吗？该家庭下的所有数据将被永久删除，此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFamilyTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteFamilyTarget && handleDeleteFamily(deleteFamilyTarget.id)}
            >
              <Trash2 className="size-4" />
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LLM Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl">
                <Bot className="size-5 text-primary" />
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
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : llmConfig && !llmEditing ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">提供商</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-sm font-medium">
                      {llmConfig.provider}
                    </p>
                    {llmConfig.is_active ? (
                      <Badge className="bg-income/15 text-income border-income/30 text-xs">
                        <CheckCircle2 className="size-3 mr-1" />
                        已启用
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        <XCircle className="size-3 mr-1" />
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
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Zap className="size-4" />
                )}
                测试连接
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
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
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
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
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Zap className="size-4" />
                  )}
                  测试
                </Button>
                <Button
                  onClick={handleSaveLlmConfig}
                  disabled={llmSaving}
                >
                  {llmSaving && (
                    <Loader2 className="size-4 animate-spin" />
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
                <Users className="size-5 text-primary" />
              </div>
              <div>
                <CardTitle>家庭成员</CardTitle>
                <CardDescription>
                  管理在交易中使用的家庭成员名称
                </CardDescription>
              </div>
            </div>
            <Button size="sm" onClick={openAddMember}>
              <Plus className="size-4" />
              添加
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingMembers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-muted-foreground">
              <Users className="size-10 mb-3 opacity-40" />
              <p className="text-sm mb-3">暂未添加家庭成员</p>
              <Button variant="outline" size="sm" onClick={openAddMember}>
                <Plus className="size-4" />
                添加成员
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-3 py-3 px-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                    {member.name.charAt(0)}
                  </div>
                  <span className="flex-1 text-sm font-medium">
                    {member.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => openEditMember(member)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
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

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            <CardTitle className="text-destructive">危险操作</CardTitle>
          </div>
          <CardDescription>以下操作不可撤销，请谨慎执行</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">清除所有记账记录</p>
              <p className="text-xs text-muted-foreground">删除当前家庭的全部交易数据</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setClearTxnDialogOpen(true); setClearTxnConfirmText(''); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              清除
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Clear Transactions Confirmation */}
      <Dialog open={clearTxnDialogOpen} onOpenChange={setClearTxnDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              确认清除所有记账记录
            </DialogTitle>
            <DialogDescription>
              此操作将永久删除当前家庭的所有交易记录，且无法恢复。请输入"删除所有记录"以确认。
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <Input
              placeholder="请输入：删除所有记录"
              value={clearTxnConfirmText}
              onChange={(e) => setClearTxnConfirmText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearTxnDialogOpen(false)} disabled={clearingTxns}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearAllTransactions}
              disabled={clearTxnConfirmText !== '删除所有记录' || clearingTxns}
            >
              {clearingTxns && <Loader2 className="size-4 animate-spin" />}
              确认清除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <Loader2 className="size-4 animate-spin" />
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
