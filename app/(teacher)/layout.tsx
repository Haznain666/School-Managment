import type { CSSProperties, ReactNode } from 'react';

import { PortalFrame } from '@/components/school/PortalFrame';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { TeacherNavbar } from '@/components/teacher/TeacherNavbar';
import { teacherNav } from '@/components/teacher/teacher-nav';
import { paletteToCSSVars } from '@/lib/branding';
import { requireSchoolRole } from '@/lib/school-guard';
import { countUnreadNotices } from '@/lib/announcement-queries';
import { listClassTeacherSections } from '@/lib/exam-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { staffIdForSchoolUser } from '@/lib/staff-self-queries';
import { getSchoolBranding } from '@/lib/school-tenant';

/**
 * Teacher portal shell — role `teacher` only.
 *
 * Session verification happens here rather than in middleware, which runs on
 * the Edge and cannot reach the database over TCP. A caller with a valid session but a
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

  // The badge is read after the profile, because it needs the school-user id
  // the profile carries. One indexed count against the delivery log.
  //
  // The class-teacher lookup rides alongside it and decides one nav entry.
  // `sections.class_teacher_id` names an HR record, so a teacher whose staff
  // record has not been entered yet is not a class teacher of anything — which
  // is the correct answer rather than an error.
  const [unreadNotices, staffId] =
    profile === null
      ? ([0, null] as const)
      : await Promise.all([
          countUnreadNotices(locationId, profile.id),
          staffIdForSchoolUser(locationId, profile.id),
        ]);

  const classTeacherSections =
    staffId === null ? [] : await listClassTeacherSections(locationId, staffId);

  const brandStyle = paletteToCSSVars(
    branding?.palette ?? null,
  ) as unknown as CSSProperties;

  const schoolName = branding?.name ?? 'School';

  return (
    <div style={brandStyle} className="bg-brand-background text-brand-text">
      <PortalFrame
        items={teacherNav(unreadNotices, classTeacherSections.length > 0)}
        ariaLabel="Teacher navigation"
        drawerTitle={schoolName}
        header={
          <TeacherNavbar
            schoolName={schoolName}
            logoUrl={branding?.logoUrl ?? null}
            userName={profile?.name ?? ''}
            role={claims.role}
            schoolSlug={claims.schoolSlug}
          />
        }
      >
        {children}
      </PortalFrame>

      {/* Registers the app shell. Renders nothing and fails silently — see
          `components/pwa/ServiceWorkerRegistrar.tsx`. */}
      <ServiceWorkerRegistrar />
    </div>
  );
}
