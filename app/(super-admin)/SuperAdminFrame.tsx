'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { TopBar } from '@/components/layout/TopBar';

/** Client-side gate for the platform-admin surface. */
export function SuperAdminFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status, user, claims } = useAuth();

  const isSuperAdmin = claims?.role === 'super_admin';

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status === 'authenticated' && !isSuperAdmin) {
      router.replace('/login');
    }
  }, [status, isSuperAdmin, router]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!isSuperAdmin || claims === null) {
    return null;
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar
        title="Platform Administration"
        email={user?.email ?? ''}
        role={claims.role}
        branchName={null}
      />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
