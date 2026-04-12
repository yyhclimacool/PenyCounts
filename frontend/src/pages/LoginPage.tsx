import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Wallet, Eye, EyeOff, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuthStore } from '@/stores/authStore';
import { login as loginApi } from '@/services/auth';
import { useToast } from '@/hooks/useToast';

export default function LoginPage() {
  const navigate = useNavigate();
  const authLogin = useAuthStore((s) => s.login);
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('请填写邮箱和密码');
      return;
    }

    setLoading(true);
    try {
      const data = await loginApi({ email, password });
      authLogin(data.token, data.user);
      toast({ title: '登录成功', description: `欢迎回来，${data.user.nickname}！` });
      navigate('/');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? '登录失败，请检查邮箱和密码';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-background to-accent/20" />
      <div className="absolute top-[-20%] right-[-10%] h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl" />
      <div className="absolute bottom-[-15%] left-[-10%] h-[400px] w-[400px] rounded-full bg-accent/10 blur-3xl" />

      <div className="relative z-10 w-full max-w-md animate-slide-up">
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105">
            <Wallet className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">PenyCounts</h1>
          <p className="mt-1 text-sm text-muted-foreground font-medium">智能家庭记账助手</p>
        </div>

        <Card className="shadow-2xl shadow-black/8 border-border/60 backdrop-blur-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">登录</CardTitle>
            <CardDescription>输入您的账号信息以继续</CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">密码</Label>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    忘记密码？
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                登录
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                还没有账号？{' '}
                <Link
                  to="/register"
                  className="font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  立即注册
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
