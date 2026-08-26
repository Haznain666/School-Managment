import type { CSSProperties, ReactNode } from 'react';

import { PortalFrame } from '@/components/school/PortalFrame';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { StudentNavbar } from '@/components/student/StudentNavbar';
import { studentNav } from '@/components/student/student-nav';
import { paletteToCSSVars } from '@/lib/branding';
import { requireSchoolRole } from '@/lib/school-guard';
import { countUnreadNotices } from '@/lib/announcement-queries';
import { countUnreadNotifications } from '@/lib/notifications';
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

  /*
   * The bell's badge. Wrapped, because `notifications` arrives in migration
   * `0032` and a layout runs on every page of this portal — §5aw is what an
   * unguarded layout read costs when the schema has not caught up.
   */
  const unreadNotifications = await countUnread(profile?.id ?? null);

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
            searchResultsHref="/student/search"
            unreadNotifications={unreadNotifications}
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

/** The bell's count, or zero when it cannot be read. Never an error page. */
async function countUnread(schoolUserId: string | null): Promise<number> {
  if (schoolUserId === null) return 0;

  try {
    return await countUnreadNotifications({ audience: 'school_user', schoolUserId });
  } catch (error) {
    console.error('[layout] notification count could not be read:', error);
    return 0;
  }
}
