'use client';

import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { UserClaimRole } from '@/lib/claims';
import { getFirebaseAuth } from '@/lib/firebase';

/** Human-readable labels for the role codes stored in claims. */
const ROLE_LABELS: Record<UserClaimRole, string> = {
  super_admin: 'Super Admin',
  school_admin: 'School Admin',
  principal: 'Principal',
  vice_principal: 'Vice Principal',
  coordinator: 'Coordinator',
  teacher: 'Teacher',
  hr_manager: 'HR Manager',
  accountant: 'Accountant',
  marketing: 'Marketing',
  student: 'Student',
  parent: 'Parent',
};

export interface TopBarProps {
  title: string;
  email: string;
  role: UserClaimRole;
  /** Branch name, or null when the user has access to all branches. */
  branchName: string | null;
}

export function TopBar({ title, email, role, branchName }: TopBarProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut(getFirebaseAuth());
      router.replace('/login');
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }, [router]);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6">
      <h1 className="truncate text-lg font-semibold text-slate-900">{title}</h1>

      <div className="flex items-center gap-3">
        <Badge variant="neutral">{ROLE_LABELS[role]}</Badge>
        <Badge variant="neutral">{branchName ?? 'All branches'}</Badge>

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
