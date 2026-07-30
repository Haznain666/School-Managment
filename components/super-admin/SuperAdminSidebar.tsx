'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

interface NavEntry {
  label: string;
  href: string;
  /** Nested links shown underneath, e.g. All Schools / Add School. */
  children?: readonly NavEntry[];
  /** Not yet built — rendered dimmed and non-interactive. */
  placeholder?: boolean;
}

const NAV: readonly NavEntry[] = [
  { label: 'Dashboard', href: '/super-admin' },
  {
    label: 'Schools',
    href: '/super-admin/schools',
    children: [
      { label: 'All Schools', href: '/super-admin/schools' },
      { label: 'Add School', href: '/super-admin/schools/new' },
    ],
  },
  { label: 'Settings', href: '/super-admin/settings', placeholder: true },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/super-admin') return pathname === '/super-admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SuperAdminSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Super Admin navigation"
      className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white"
    >
      <div className="border-b border-slate-200 px-4 py-4">
        <p className="text-sm font-semibold text-slate-900">SMS Platform</p>
        <p className="text-xs text-slate-500">Super Admin</p>
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV.map((entry) => (
          <li key={entry.href}>
            {entry.placeholder === true ? (
              <span
                aria-disabled="true"
                title="Coming in a later sprint"
                className="block cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-slate-400"
              >
                {entry.label}
              </span>
            ) : (
              <Link
                href={entry.href}
                aria-current={isActive(pathname, entry.href) ? 'page' : undefined}
                className={cn(
                  'block rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive(pathname, entry.href)
                    ? 'bg-brand-primary/10 text-brand-primary'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                {entry.label}
              </Link>
            )}

            {entry.children !== undefined ? (
              <ul className="mt-1 space-y-0.5 border-l border-slate-200 pl-3">
                {entry.children.map((child) => (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      aria-current={pathname === child.href ? 'page' : undefined}
                      className={cn(
                        'block rounded-md px-3 py-1.5 text-sm transition',
                        pathname === child.href
                          ? 'font-medium text-brand-primary'
                          : 'text-slate-500 hover:text-slate-900',
                      )}
                    >
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}
