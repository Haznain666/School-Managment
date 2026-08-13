'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

export interface SchoolTabsProps {
  schoolId: string;
}

/**
 * School detail tab bar.
 *
 * Real routes rather than client-side state, so each tab is linkable,
 * refreshable and back-button friendly.
 */
export function SchoolTabs({ schoolId }: SchoolTabsProps) {
  const pathname = usePathname();
  const base = `/super-admin/schools/${schoolId}`;

  const tabs = [
    { label: 'Overview', href: base },
    { label: 'Modules', href: `${base}/modules` },
    { label: 'Integrations', href: `${base}/integrations` },
    { label: 'Branding', href: `${base}/branding` },
    { label: 'Branches', href: `${base}/branches` },
    { label: 'Users', href: `${base}/users` },
  ];

  return (
    <nav aria-label="School sections" className="border-b border-line">
      <ul className="-mb-px flex gap-1">
        {tabs.map((tab) => {
          // Overview is the base path, so it must match exactly or every
          // sub-route would light it up too.
          const active =
            tab.href === base
              ? pathname === base
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`);

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-block border-b-2 px-4 py-2.5 text-sm font-medium transition',
                  active
                    ? 'border-brand-primary text-brand-primary'
                    : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
