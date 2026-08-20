import { Suspense } from 'react';

import { ChildSwitcher } from '@/components/parent/ChildSwitcher';
import { SchoolNavbar } from '@/components/school/SchoolNavbar';
import type { UserRole } from '@/types/school-auth';

export interface ParentNavbarProps {
  schoolName: string;
  logoUrl: string | null;
  userName: string;
  role: UserRole;
  schoolSlug: string | null;
  /** Every child this login is recorded against. Empty for a new account. */
  students: readonly { studentProfileId: string; studentId: string; name: string }[];
}

/**
 * Parent portal top bar — the shared navbar, a fixed label, and the child
 * switcher.
 *
 * The switcher is wrapped in `Suspense` because it reads `useSearchParams`.
 * The parent layout is `force-dynamic`, so this boundary is never actually hit
 * in production — it is here so that a future change to the layout's rendering
 * mode fails as a slower header rather than as a build error nobody can place.
 */
export function ParentNavbar({ students, ...props }: ParentNavbarProps) {
  return (
    <SchoolNavbar
      {...props}
      portalLabel="Parent Portal"
      contextSlot={
        <Suspense fallback={null}>
          <ChildSwitcher students={students} />
        </Suspense>
      }
    />
  );
}
