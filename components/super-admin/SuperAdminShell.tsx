'use client';

import { X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  SuperAdminNavTree,
  SuperAdminSidebar,
} from '@/components/super-admin/SuperAdminSidebar';
import { SuperAdminTopBar } from '@/components/super-admin/SuperAdminTopBar';
import { Icon } from '@/components/ui/Icon';

/**
 * The Super Admin frame.
 *
 * Separate from `PortalFrame` on purpose. That one paints itself in the
 * tenant's `secondary` and takes a flat item/section list; this surface is
 * cross-tenant, uses the platform's own neutral tokens, and has a two-level
 * tree (Schools → All Schools / Add School) that the portal list does not
 * model. Forcing them together would mean either flattening "Add School" into a
 * top-level destination it is not, or teaching the portal nav a nesting level
 * no portal uses.
 *
 * What it does share is the fix: the navigation used to be a permanently
 * visible 240px column with no mobile form at all, so on a phone it ate a third
 * of the screen and still could not be scrolled to properly. It is now a
 * drawer below `md`, exactly as the school portals are.
 */
export function SuperAdminShell({
  email,
  unreadNotifications,
  children,
}: {
  email: string;
  /** Read in the layout, so the bell's badge is right in the first frame. */
  unreadNotifications?: number;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDivElement>(null);

  // Navigating closes it — otherwise the new page loads behind a drawer that is
  // still covering it, which reads as the tap having done nothing.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      <SuperAdminSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <SuperAdminTopBar
          email={email}
          onOpenNav={() => setDrawerOpen(true)}
          unreadNotifications={unreadNotifications}
        />
        {/*
          `relative` for the same reason as `PortalFrame`'s main, and it was
          measured on *this* surface: `sr-only` is `position: absolute`, and
          without a positioned ancestor those spans escape the `overflow-y`
          below and give the document a second scrollbar over a blank strip.
          See the long note in `components/school/PortalFrame.tsx`.
        */}
        <main className="relative flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>

      {drawerOpen ? (
        <div className="md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-backdrop cursor-default bg-[rgb(2_6_23/0.55)] animate-fade-in"
          />

          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Super Admin navigation"
            tabIndex={-1}
            className="fixed inset-y-0 left-0 z-modal flex w-72 max-w-[85vw] flex-col bg-surface-raised shadow-modal focus-visible:outline-none animate-slide-up"
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink">SMS Platform</p>
                <p className="text-xs text-ink-muted">Super Admin</p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="-mr-1 rounded-control p-1.5 text-ink-muted transition-colors duration-fast hover:bg-surface-hover hover:text-ink"
              >
                <Icon as={X} size="sm" label="Close navigation" />
              </button>
            </div>

            <SuperAdminNavTree />
          </div>
        </div>
      ) : null}
    </div>
  );
}
