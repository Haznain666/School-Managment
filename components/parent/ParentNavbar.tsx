import { SchoolNavbar } from '@/components/school/SchoolNavbar';
import type { UserRole } from '@/types/school-auth';

export interface ParentNavbarProps {
  schoolName: string;
  logoUrl: string | null;
  userName: string;
  role: UserRole;
  schoolSlug: string | null;
}

/** Parent portal top bar — the shared navbar with a fixed portal label. */
export function ParentNavbar(props: ParentNavbarProps) {
  return <SchoolNavbar {...props} portalLabel="Parent Portal" />;
}
