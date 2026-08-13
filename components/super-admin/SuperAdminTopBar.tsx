'use client';

import { LogOut, Menu } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

export interface SuperAdminTopBarProps {
  email: string;
  /** Opens the mobile navigation drawer. Owned by `SuperAdminShell`. */
  onOpenNav?: () => void;
}

/**
 * Platform top bar.
 *
 * On the platform's own neutral tokens rather than a school's palette — see
 * `SuperAdminSidebar` for why this surface must look unmistakably unlike a
 * tenant portal.
 */
export function SuperAdminTopBar({ email, onOpenNav }: SuperAdminTopBarProps) {
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
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface-raised px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {onOpenNav !== undefined ? (
          <button
            type="button"
            onClick={onOpenNav}
            className="-ml-1 rounded-control p-2 text-ink-muted transition-colors duration-fast hover:bg-surface-hover hover:text-ink md:hidden"
          >
            <Icon as={Menu} size="md" label="Open navigation" />
          </button>
        ) : null}

        {/*
          Shortened on a phone. "Platform Administration" at 375px leaves no
          room for the sign-out control, and the operator on a phone already
          knows which product they signed in to.
        */}
        <h1 className="truncate text-lg font-semibold text-ink">
          <span className="hidden sm:inline">Platform Administration</span>
          <span className="sm:hidden">Platform</span>
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden max-w-[16rem] truncate text-sm text-ink-muted lg:inline">
          {email}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={LogOut}
          isLoading={isSigningOut}
          onClick={() => {
            void handleSignOut();
          }}
        >
          <span className="hidden sm:inline">Sign out</span>
          <span className="sr-only sm:hidden">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
