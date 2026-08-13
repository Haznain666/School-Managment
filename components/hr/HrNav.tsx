'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

/**
 * Sub-navigation across the HR and Payroll screens.
 *
 * The sidebar carries two entries — HR and Payroll — rather than eight, because
 * running a school's staff is one job with several steps, not eight
 * destinations an HR manager picks between. This strip is what makes the rest
 * reachable without turning the sidebar into a table of contents.
 */

const LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/dashboard/hr', label: 'Overview' },
  { href: '/dashboard/hr/staff', label: 'Staff' },
  { href: '/dashboard/hr/salary-components', label: 'Salary components' },
  { href: '/dashboard/hr/leave', label: 'Leave' },
  { href: '/dashboard/hr/attendance', label: 'Staff register' },
  { href: '/dashboard/payroll', label: 'Payroll' },
];

export function HrNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="HR and payroll" className="flex flex-wrap gap-2">
      {LINKS.map((link) => {
        const isCurrent =
          link.href === '/dashboard/hr'
            ? pathname === link.href
            : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isCurrent ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition',
              isCurrent
                ? 'bg-brand-primary text-brand-onPrimary'
                : 'bg-surface-sunken text-ink-muted hover:bg-line',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
