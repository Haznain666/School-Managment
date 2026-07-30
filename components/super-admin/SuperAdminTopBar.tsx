'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';

export interface SuperAdminTopBarProps {
  email: string;
}

export function SuperAdminTopBar({ email }: SuperAdminTopBarProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await fetch('/api/super-admin/auth/logout', { method: 'POST' });
      router.replace('/super-admin/login');
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }, [router]);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6">
      <h1 className="text-lg font-semibold text-slate-900">Platform Administration</h1>

      <div className="flex items-center gap-3">
        <span className="hidden truncate text-sm text-slate-500 sm:inline">{email}</span>
        <Button
          variant="ghost"
          size="sm"
          isLoading={isSigningOut}
          onClick={() => {
            void handleSignOut();
          }}
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}
