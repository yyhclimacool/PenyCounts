import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, XCircle, Loader2, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { verifyEmail } from '@/services/auth';

type Status = 'loading' | 'success' | 'error';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('验证链接无效或已过期');
      return;
    }

    verifyEmail({ token })
      .then(() => setStatus('success'))
      .catch((err: unknown) => {
        setStatus('error');
        setErrorMessage(
          (err as { response?: { data?: { detail?: string } } })?.response?.data
            ?.detail ?? '邮箱验证失败，请稍后重试',
        );
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/10 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Wallet className="h-7 w-7" />
          </div>
        </div>

        <Card className="shadow-xl shadow-black/5">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">邮箱验证</CardTitle>
          </CardHeader>

          <CardContent className="flex flex-col items-center gap-4 pb-8">
            {status === 'loading' && (
              <>
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">正在验证您的邮箱...</p>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-income/10">
                  <CheckCircle2 className="h-8 w-8 text-income" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-foreground">邮箱验证成功！</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    您的账号已激活，现在可以登录了
                  </p>
                </div>
                <Button asChild className="mt-2 w-full">
                  <Link to="/login">前往登录</Link>
                </Button>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                  <XCircle className="h-8 w-8 text-destructive" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-foreground">验证失败</p>
                  <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
                </div>
                <Button asChild variant="outline" className="mt-2 w-full">
                  <Link to="/login">返回登录</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
