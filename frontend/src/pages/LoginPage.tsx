import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Wallet, Loader2 } from 'lucide-react';

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

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }

    setLoading(true);
    try {
      const data = await loginApi({ username: username.trim(), password });
      authLogin(data.token, data.user);
      toast({ title: '登录成功', description: `欢迎回来，${data.user.nickname}！` });
      navigate('/');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? '登录失败，用户名或密码错误';
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
          <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105">
            <Wallet className="size-7" />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">PenyCounts</h1>
          <p className="mt-1 text-sm text-muted-foreground font-medium">智能家庭记账助手</p>
        </div>

        <Card className="shadow-2xl shadow-black/8 border-border/60 backdrop-blur-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">登录</CardTitle>
            <CardDescription>输入用户名和密码以继续</CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="flex flex-col gap-4">
              {error && (
                <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="请输入用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin" />}
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
