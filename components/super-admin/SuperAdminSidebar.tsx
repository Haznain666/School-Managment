'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { NAV_ICONS, type NavIconName } from '@/components/school/nav-icons';
import { Icon } from '@/components/ui/Icon';
import type { SuperAdminArea } from '@/lib/super-admin-permissions';
import { cn } from '@/lib/utils';

interface NavEntry {
  label: string;
  href: string;
  icon: NavIconName;
  /**
   * Sprint 35 — the area an operator must be able to view for this entry to
   * be drawn. Absent means every operator sees it. Navigation only: the page
   * and its routes check again.
   */
  area?: SuperAdminArea;
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
    area: 'schools',
    children: [
      { label: 'All Schools', href: '/super-admin/schools', icon: 'schools' },
      { label: 'Add School', href: '/super-admin/schools/new', icon: 'enroll' },
    ],
  },
  // Cross-school rather than per-school, so it sits beside Schools rather than
  // under it — it is not a view of one tenant.
  { label: 'Modules', href: '/super-admin/modules', icon: 'modules', area: 'modules' },
  /*
   * Sprint 35. Cross-school like Modules: every invoice from every school, and
   * the platform's own bank accounts. A school's rates and its access live on
   * that school's Billing tab.
   */
  {
    label: 'Billing',
    href: '/super-admin/billing',
    icon: 'finance',
    area: 'billing',
    children: [
      { label: 'Invoices', href: '/super-admin/billing', icon: 'finance' },
      { label: 'Bank accounts', href: '/super-admin/billing/bank-accounts', icon: 'finance' },
    ],
  },
  // Sprint 16. Cross-school, like Modules: the queue is one queue, and reading
  // it per tenant would be reading it in four places and answering none of them.
  { label: 'Feedback', href: '/super-admin/feedback', icon: 'feedback', area: 'feedback' },
  /*
   * Sprint 34. Reference rather than operation, which is why they sit last:
   * nothing above them is optional on any given day, and these two are opened
   * when somebody is answering a question rather than doing the work.
   *
   * Features before Roadmap because that is the order they are read in — what
   * the product does, and then what it does not do yet. Both are static pages
   * built from `lib/product-catalogue.ts`; neither reads the database, so
   * neither costs a query to open.
   */
  { label: 'Features', href: '/super-admin/features', icon: 'features', area: 'catalogue' },
  { label: 'Roadmap', href: '/super-admin/roadmap', icon: 'roadmap', area: 'catalogue' },
  // Sprint 35, section 9. Last: who operates the platform, and your own account.
  { label: 'Super admins', href: '/super-admin/admins', icon: 'users', area: 'super_admins' },
  { label: 'My account', href: '/super-admin/account', icon: 'settings' },
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
export function SuperAdminSidebar({ visibleAreas }: { visibleAreas: readonly SuperAdminArea[] }) {
  return (
    <nav
      aria-label="Super Admin navigation"
      className="hidden h-full w-60 shrink-0 flex-col border-r border-line bg-surface-raised md:flex"
    >
      <div className="border-b border-line px-4 py-4">
        <PlatformWordmark />
        <p className="mt-1 text-xs text-ink-muted">Super Admin</p>
      </div>

      <SuperAdminNavTree visibleAreas={visibleAreas} />
    </nav>
  );
}

/**
 * The SchoolHub word mark — Sprint 35, section 8. The platform's brand, never a
 * school's: this surface is deliberately unpainted (see above), and the mark is
 * what says which product the operator is in.
 */
export function PlatformWordmark() {
  return (
    <Image
      src="/brand/schoolhub-logo.png"
      alt="SchoolHub"
      width={1774}
      height={319}
      priority
      className="h-7 w-auto"
    />
  );
}

/**
 * The link tree itself, so the desktop sidebar and the mobile drawer render one
 * definition rather than two that drift.
 */
export function SuperAdminNavTree({ visibleAreas }: { visibleAreas: readonly SuperAdminArea[] }) {
  const pathname = usePathname();
  const entries = NAV.filter((entry) => entry.area === undefined || visibleAreas.includes(entry.area));

  return (
    <ul className="flex-1 space-y-1 overflow-y-auto p-3">
        {entries.map((entry) => {
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
