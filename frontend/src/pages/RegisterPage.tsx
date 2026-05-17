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
import { register } from '@/services/auth';
import { useToast } from '@/hooks/useToast';

export default function RegisterPage() {
  const navigate = useNavigate();
  const authLogin = useAuthStore((s) => s.login);
  const { toast } = useToast();

  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }

    setLoading(true);
    try {
      const data = await register({ username: username.trim() });
      authLogin(data.token, data.user);
      toast({ title: '注册成功', description: `欢迎，${data.user.nickname}！` });
      navigate('/');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? '注册失败，请稍后重试';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/10 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Wallet className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-foreground">PenyCounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">创建您的账号</p>
        </div>

        <Card className="shadow-xl shadow-black/5">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">注册</CardTitle>
            <CardDescription>输入用户名即可创建账号</CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
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
            </CardContent>

            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                注册
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                已有账号？{' '}
                <Link
                  to="/login"
                  className="font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  立即登录
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
