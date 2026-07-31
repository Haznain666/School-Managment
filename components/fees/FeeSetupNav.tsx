'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

/**
 * Sub-navigation across the three setup screens.
 *
 * The sidebar carries one Fee Structure entry rather than three, because
 * "types, structure, concessions" is one job done in order — not three
 * destinations a bursar picks between. This strip is what makes the other two
 * reachable without cluttering the sidebar with the whole sequence.
 */

const LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/dashboard/fees/types', label: 'Fee types' },
  { href: '/dashboard/fees/structures', label: 'Price list' },
  { href: '/dashboard/fees/concessions', label: 'Concessions' },
];

export function FeeSetupNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Fee setup" className="flex flex-wrap gap-2">
      {LINKS.map((link) => {
        const isCurrent = pathname === link.href;

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isCurrent ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition',
              isCurrent
                ? 'bg-brand-primary text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
