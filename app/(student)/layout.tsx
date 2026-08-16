import type { CSSProperties, ReactNode } from 'react';

import { PortalFrame } from '@/components/school/PortalFrame';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { StudentNavbar } from '@/components/student/StudentNavbar';
import { studentNav } from '@/components/student/student-nav';
import { paletteToCSSVars } from '@/lib/branding';
import { requireSchoolRole } from '@/lib/school-guard';
import { countUnreadNotices } from '@/lib/announcement-queries';
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

  // The badge is read after the profile, because it needs the school-user id
  // the profile carries. One indexed count against the delivery log.
  const unreadNotices =
    profile === null ? 0 : await countUnreadNotices(locationId, profile.id);

  const brandStyle = paletteToCSSVars(
    branding?.palette ?? null,
  ) as unknown as CSSProperties;

  const schoolName = branding?.name ?? 'School';

  return (
    <div style={brandStyle} className="bg-brand-background text-brand-text">
      <PortalFrame
        items={studentNav(unreadNotices)}
        ariaLabel="Student navigation"
        drawerTitle={schoolName}
        header={
          <StudentNavbar
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
