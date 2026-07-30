import { PortalSidebar, type PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Student portal navigation.
 *
 * Everything past the dashboard is marked as a placeholder — those destinations
 * arrive with the Academics and Fee Management modules in later sprints.
 */
const ITEMS: readonly PortalNavItem[] = [
  { label: 'My Dashboard', href: '/student' },
  { label: 'My Classes', href: '/student/classes', placeholder: true },
  { label: 'My Grades', href: '/student/grades', placeholder: true },
  { label: 'Fee Status', href: '/student/fees', placeholder: true },
];

export function StudentSidebar() {
  return <PortalSidebar items={ITEMS} ariaLabel="Student navigation" />;
}
