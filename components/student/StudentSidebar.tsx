import { PortalSidebar, type PortalNavItem } from '@/components/school/PortalSidebar';

/**
 * Student portal navigation.
 *
 * The timetable is a real destination as of Sprint 6. What remains a
 * placeholder arrives with a later sprint.
 */
const ITEMS: readonly PortalNavItem[] = [
  { label: 'My Dashboard', href: '/student' },
  { label: 'My Timetable', href: '/student/timetable' },
  { label: 'My Classes', href: '/student/classes', placeholder: true },
  { label: 'My Grades', href: '/student/grades', placeholder: true },
  { label: 'Fee Status', href: '/student/fees', placeholder: true },
];

export function StudentSidebar() {
  return <PortalSidebar items={ITEMS} ariaLabel="Student navigation" />;
}
