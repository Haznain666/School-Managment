import { SchoolNavbar } from '@/components/school/SchoolNavbar';
import type { UserRole } from '@/types/school-auth';

export interface StudentNavbarProps {
  schoolName: string;
  logoUrl: string | null;
  userName: string;
  role: UserRole;
  schoolSlug: string | null;
  searchResultsHref?: string;
  unreadNotifications?: number;
}

/** Student portal top bar — the shared navbar with a fixed portal label. */
export function StudentNavbar(props: StudentNavbarProps) {
  return <SchoolNavbar {...props} portalLabel="Student Portal" />;
}
