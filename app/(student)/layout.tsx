import type { CSSProperties, ReactNode } from 'react';

import { StudentNavbar } from '@/components/student/StudentNavbar';
import { StudentSidebar } from '@/components/student/StudentSidebar';
import { paletteToCSSVars } from '@/lib/branding';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { getSchoolBranding } from '@/lib/school-tenant';

/**
 * Student portal shell — role `student` only.
 *
 * Session verification happens here rather than in middleware, which runs on
 * the Edge and cannot reach the database over TCP. A caller with a valid session but a
 * different role is redirected to their own portal.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StudentLayout({ children }: { children: ReactNode }) {
  const { claims, locationId } = await requireSchoolRole(['student']);

  const [branding, profile] = await Promise.all([
    getSchoolBranding(locationId),
    getSchoolUserByUid(locationId, claims.uid),
  ]);

  const brandStyle = paletteToCSSVars(
    branding?.palette ?? null,
  ) as unknown as CSSProperties;

  return (
    <div style={brandStyle} className="flex h-screen bg-brand-background text-brand-text">
      <StudentSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <StudentNavbar
          schoolName={branding?.name ?? 'School'}
          logoUrl={branding?.logoUrl ?? null}
          userName={profile?.name ?? ''}
          role={claims.role}
          schoolSlug={claims.schoolSlug}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
