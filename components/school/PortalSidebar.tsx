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

/** A titled group of links, for a module with several screens of its own. */
export interface PortalNavSection {
  label: string;
  items: readonly PortalNavItem[];
}

export interface PortalSidebarProps {
  items: readonly PortalNavItem[];
  /** Rendered below `items`, each under its own heading. */
  sections?: readonly PortalNavSection[];
  ariaLabel: string;
}

/**
 * Sidebar shared by all four portals.
 *
 * Which items appear is decided server-side (by role, and by which modules the
 * school has enabled) and passed in — a disabled module is absent from this
 * list entirely rather than hidden with CSS.
 */
export function PortalSidebar({ items, sections, ariaLabel }: PortalSidebarProps) {
  const pathname = usePathname();

  /**
   * Prefix matching, except for the exact link.
   *
   * `/dashboard/admissions` is the parent of every other Admissions route, so
   * matching it by prefix would light up the overview link on every child page.
   * Longer siblings win by being checked against the full path.
   */
  const isCurrent = (href: string): boolean => {
    if (pathname === href) return true;
    if (!pathname.startsWith(`${href}/`)) return false;

    const siblings = [...items, ...(sections ?? []).flatMap((section) => section.items)];
    return !siblings.some(
      (sibling) =>
        sibling.href !== href &&
        sibling.href.startsWith(`${href}/`) &&
        (pathname === sibling.href || pathname.startsWith(`${sibling.href}/`)),
    );
  };

  const renderItem = (item: PortalNavItem) => {
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

    const isActive = isCurrent(item.href);

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
  };

  return (
    <nav
      aria-label={ariaLabel}
      className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex"
    >
      <div className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">{items.map(renderItem)}</ul>

        {(sections ?? []).map((section) => (
          <div key={section.label} className="mt-6">
            <h2 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {section.label}
            </h2>
            <ul className="space-y-1">{section.items.map(renderItem)}</ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
