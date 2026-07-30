'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

export interface PortalNavItem {
  label: string;
  href: string;
  /** Not built yet — rendered dimmed and non-interactive. */
  placeholder?: boolean;
}

export interface PortalSidebarProps {
  items: readonly PortalNavItem[];
  ariaLabel: string;
}

/**
 * Sidebar shared by all four portals.
 *
 * Which items appear is decided server-side (by role, and by which modules the
 * school has enabled) and passed in — a disabled module is absent from this
 * list entirely rather than hidden with CSS.
 */
export function PortalSidebar({ items, ariaLabel }: PortalSidebarProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={ariaLabel}
      className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex"
    >
      <ul className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          if (item.placeholder === true) {
            return (
              <li key={item.href}>
                <span
                  aria-disabled="true"
                  title="Coming in a later sprint"
                  className="block cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-slate-400"
                >
                  {item.label}
                </span>
              </li>
            );
          }

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'block rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive
                    ? 'bg-brand-primary/10 text-brand-primary'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
