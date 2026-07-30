'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { SchoolModuleFlags } from '@/db/schema';
import type { UserClaimRole } from '@/lib/claims';
import { cn } from '@/lib/utils';

export interface NavItem {
  label: string;
  href: string;
  /** Roles allowed to see this item. Empty = everyone signed in. */
  roles?: readonly UserClaimRole[];
  /** Module flag that must be enabled for this school. */
  module?: keyof SchoolModuleFlags;
}

export interface SidebarProps {
  items: readonly NavItem[];
  role: UserClaimRole;
  moduleFlags: SchoolModuleFlags;
  schoolName: string;
  logoUrl: string | null;
}

function isVisible(
  item: NavItem,
  role: UserClaimRole,
  moduleFlags: SchoolModuleFlags,
): boolean {
  if (item.module !== undefined && !moduleFlags[item.module]) return false;
  if (item.roles === undefined || item.roles.length === 0) return true;
  // super_admin sees everything.
  return role === 'super_admin' || item.roles.includes(role);
}

export function Sidebar({
  items,
  role,
  moduleFlags,
  schoolName,
  logoUrl,
}: SidebarProps) {
  const pathname = usePathname();
  const visibleItems = items.filter((item) => isVisible(item, role, moduleFlags));

  return (
    <nav
      aria-label="Portal navigation"
      className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white"
    >
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
        {logoUrl !== null ? (
          // Logos come from Firebase Storage at unpredictable dimensions;
          // a plain <img> avoids forcing a layout size on them.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="h-9 w-9 rounded-md object-contain"
            loading="lazy"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-primary text-sm font-semibold text-white"
          >
            {schoolName.slice(0, 2).toUpperCase()}
          </span>
        )}
        <span className="truncate text-sm font-semibold text-slate-900">
          {schoolName}
        </span>
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

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
