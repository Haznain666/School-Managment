import { SchoolNavbar } from '@/components/school/SchoolNavbar';
import type { UserRole } from '@/types/school-auth';

export interface TeacherNavbarProps {
  schoolName: string;
  logoUrl: string | null;
  userName: string;
  role: UserRole;
  schoolSlug: string | null;
  searchResultsHref?: string;
  unreadNotifications?: number;
}

/** Teacher portal top bar — the shared navbar with a fixed portal label. */
export function TeacherNavbar(props: TeacherNavbarProps) {
  return <SchoolNavbar {...props} portalLabel="Teacher Portal" />;
}
