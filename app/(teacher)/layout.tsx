import type { CSSProperties, ReactNode } from 'react';

import { TeacherNavbar } from '@/components/teacher/TeacherNavbar';
import { TeacherSidebar } from '@/components/teacher/TeacherSidebar';
import { paletteToCSSVars } from '@/lib/branding';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { getSchoolBranding } from '@/lib/school-tenant';

/**
 * Teacher portal shell — role `teacher` only.
 *
 * Session verification happens here rather than in middleware, which runs on
 * the Edge and cannot use firebase-admin. A caller with a valid session but a
 * different role is redirected to their own portal.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function TeacherLayout({ children }: { children: ReactNode }) {
  const { claims, locationId } = await requireSchoolRole(['teacher']);

  const [branding, profile] = await Promise.all([
    getSchoolBranding(locationId),
    getSchoolUserByUid(locationId, claims.uid),
  ]);

  const brandStyle = paletteToCSSVars(
    branding?.palette ?? null,
  ) as unknown as CSSProperties;

  return (
    <div style={brandStyle} className="flex h-screen bg-slate-50">
      <TeacherSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TeacherNavbar
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
