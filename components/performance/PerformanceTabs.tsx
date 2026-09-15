import { LinkTabs, type LinkTabItem } from '@/components/ui/Tabs';
import type { Permission } from '@/lib/permissions';
import type { UserRole } from '@/types/school-auth';

/**
 * The Staff performance screens' tabs — Sprint 32.
 *
 * Built from the same facts the sidebar is, so a tab never leads somewhere the
 * page will bounce. Setup is for the School Administrator and the heads; "My
 * performance" is for everybody who is themselves rated, which the School
 * Administrator is not.
 */
export function performanceTabItems(
  role: UserRole,
  permissions: readonly Permission[],
): LinkTabItem[] {
  const items: LinkTabItem[] = [];
  if (permissions.includes('kpis.read') || permissions.includes('kpis.overall')) {
    items.push({ label: 'Overview', href: '/dashboard/performance' });
  }
  if (permissions.includes('kpis.read')) {
    items.push({ label: 'KPIs', href: '/dashboard/performance/kpis' });
  }
  if (canOpenSetup(role, permissions)) {
    items.push({ label: 'Setup', href: '/dashboard/performance/setup' });
  }
  if (role !== 'school_admin') {
    items.push({ label: 'My performance', href: '/dashboard/performance/me' });
  }
  return items;
}

export function canOpenSetup(role: UserRole, permissions: readonly Permission[]): boolean {
  return (
    permissions.includes('permissions.manage') || role === 'principal' || role === 'vice_principal'
  );
}

export function PerformanceTabs({
  role,
  permissions,
  current,
}: {
  role: UserRole;
  permissions: readonly Permission[];
  current: string;
}) {
  const items = performanceTabItems(role, permissions);
  if (items.length < 2) return null;
  return <LinkTabs items={items} currentHref={current} ariaLabel="Staff performance" />;
}
