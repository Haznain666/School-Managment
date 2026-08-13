'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { NAV_ICONS, type NavIconName } from '@/components/school/nav-icons';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

interface NavEntry {
  label: string;
  href: string;
  icon: NavIconName;
  /** Nested links shown underneath, e.g. All Schools / Add School. */
  children?: readonly NavEntry[];
}

/**
 * There was a dimmed "Settings" entry here. It pointed at
 * `/super-admin/settings`, which was never built and is not on the roadmap:
 * everything a Super Admin configures is per-school and lives on that school's
 * own tabs, and the one cross-school screen is Modules. A permanently disabled
 * link is not a promise, it is a dead end the operator keeps re-testing, so it
 * is gone rather than pointed somewhere.
 */
const NAV: readonly NavEntry[] = [
  { label: 'Dashboard', href: '/super-admin', icon: 'dashboard' },
  {
    label: 'Schools',
    href: '/super-admin/schools',
    icon: 'schools',
    children: [
      { label: 'All Schools', href: '/super-admin/schools', icon: 'schools' },
      { label: 'Add School', href: '/super-admin/schools/new', icon: 'enroll' },
    ],
  },
  // Cross-school rather than per-school, so it sits beside Schools rather than
  // under it — it is not a view of one tenant.
  { label: 'Modules', href: '/super-admin/modules', icon: 'modules' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/super-admin') return pathname === '/super-admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Super Admin navigation.
 *
 * ── Not painted in a school's colours, and that is deliberate ────────────
 * Every other shell in this product wears the tenant's palette. This one must
 * not: it is cross-tenant, and an operator who has just been inside a school's
 * portal needs the platform surface to look unmistakably different, or
 * "which school am I about to switch off Fee Management for" becomes a question
 * the interface has stopped answering.
 *
 * So it uses the *platform* tokens — `surface`, `ink`, `line` — which on this
 * route resolve to the defaults in `globals.css` because no palette has been
 * applied above it. That is a real change from Sprint 10.5: this file was
 * hardcoded `bg-white`, `border-slate-200`, `text-slate-900` and
 * `text-slate-500` throughout, which happened to look the same but could never
 * respond to anything.
 */
export function SuperAdminSidebar() {
  return (
    <nav
      aria-label="Super Admin navigation"
      className="hidden h-full w-60 shrink-0 flex-col border-r border-line bg-surface-raised md:flex"
    >
      <div className="border-b border-line px-4 py-4">
        <p className="text-sm font-semibold text-ink">SMS Platform</p>
        <p className="text-xs text-ink-muted">Super Admin</p>
      </div>

      <SuperAdminNavTree />
    </nav>
  );
}

/**
 * The link tree itself, so the desktop sidebar and the mobile drawer render one
 * definition rather than two that drift.
 */
export function SuperAdminNavTree() {
  const pathname = usePathname();

  return (
    <ul className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV.map((entry) => {
          const active = isActive(pathname, entry.href);

          return (
            <li key={entry.href}>
              <Link
                href={entry.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium',
                  'transition-colors duration-fast',
                  active
                    ? 'bg-brand-primarySubtle text-brand-onPrimarySubtle'
                    : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
                )}
              >
                <Icon as={NAV_ICONS[entry.icon]} size="sm" />
                {entry.label}
              </Link>

              {entry.children !== undefined ? (
                <ul className="mt-1 space-y-0.5 border-l border-line pl-3">
                  {entry.children.map((child) => (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        aria-current={pathname === child.href ? 'page' : undefined}
                        className={cn(
                          'block rounded-control px-2.5 py-1.5 text-sm transition-colors duration-fast',
                          pathname === child.href
                            ? 'font-medium text-brand-primaryInk'
                            : 'text-ink-muted hover:text-ink',
                        )}
                      >
                        {child.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
    </ul>
  );
}
