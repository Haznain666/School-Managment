'use client';

import { LogOut, Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { GlobalSearch } from '@/components/ui/GlobalSearch';
import { Icon } from '@/components/ui/Icon';
import { NotificationBell } from '@/components/ui/NotificationBell';

export interface SuperAdminTopBarProps {
  email: string;
  /** Opens the mobile navigation drawer. Owned by `SuperAdminShell`. */
  onOpenNav?: () => void;
  /** Unread platform notifications, read once in the layout. */
  unreadNotifications?: number;
}

/**
 * Platform top bar.
 *
 * On the platform's own neutral tokens rather than a school's palette — see
 * `SuperAdminSidebar` for why this surface must look unmistakably unlike a
 * tenant portal.
 */
export function SuperAdminTopBar({
  email,
  onOpenNav,
  unreadNotifications,
}: SuperAdminTopBarProps) {
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
          A `<p>`, not an `<h1>`. This is the name of the surface, and it is
          identical on every screen — so as a heading it would compete with each
          page's own title for the document's one `h1`, and a screen-reader user
          jumping by heading would land on "Platform Administration" whatever
          they had navigated to.

          Shortened on a phone: the full string at 375px leaves no room for the
          sign-out control, and an operator on a phone already knows which
          product they signed in to.
        */}
        <p className="truncate text-lg font-semibold text-ink">
          <span className="hidden sm:inline">Platform Administration</span>
          <span className="sm:hidden">Platform</span>
        </p>
      </div>

      {/*
        `tone="neutral"`, not the brand tint the school portals use. This
        surface is deliberately not painted in any school's colours — see
        `SuperAdminSidebar` — and a search box borrowing a tenant's palette here
        would undo exactly the distinction that keeps an operator from
        misreading which school they are inside.
      */}
      <div className="hidden min-w-[16rem] flex-1 justify-center px-2 md:flex">
        <GlobalSearch
          endpoint="/api/super-admin/search"
          resultsHref="/super-admin/search"
          placeholder="Search schools, campuses, people…  /"
          tone="neutral"
          className="w-full max-w-md"
        />
      </div>

      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/* The phone's way in — the dropdown needs 20rem it does not have. */}
        <Link
          href="/super-admin/search"
          className="rounded-control p-2 text-ink-muted transition-colors duration-fast hover:bg-surface-hover hover:text-ink md:hidden"
        >
          <Icon as={Search} size="md" label="Search" />
        </Link>

        {unreadNotifications === undefined ? null : (
          <NotificationBell
            endpoint="/api/super-admin/notifications"
            initialUnread={unreadNotifications}
            tone="neutral"
          />
        )}

        <span className="hidden max-w-[10rem] shrink truncate text-sm text-ink-muted lg:inline">
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
