import type { CSSProperties, ReactNode } from 'react';

import { PortalFrame } from '@/components/school/PortalFrame';
import { SchoolNavbar } from '@/components/school/SchoolNavbar';
import { schoolNav } from '@/components/school/school-nav';
import { paletteToCSSVars } from '@/lib/branding';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolBranding } from '@/lib/school-tenant';
import { getModuleFlags, getSchoolUserByUid } from '@/lib/school-queries';
import { countUnreadNotifications } from '@/lib/notifications';
import { permissionsForRole } from '@/lib/permission-queries';
import { emptyModuleFlags } from '@/lib/platform-modules';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

/**
 * Administrative portal shell for every role that lands on /dashboard.
 *
 * This is where the session is actually verified — middleware only checked
 * that a cookie was present, because it runs on the Edge and cannot use
 * the database over TCP. `requireSchoolRole` redirects rather than returning when
 * access is refused, so nothing below it renders for the wrong caller.
 *
 * The shell gate stays a role list rather than a permission: it decides which
 * portal someone lands in, not what they may do inside it. A role with every
 * permission revoked should still reach an empty dashboard rather than a
 * redirect loop. What they see *in* the sidebar is permission-driven, and
 * resolved once here.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function SchoolAdminLayout({ children }: { children: ReactNode }) {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const [branding, moduleFlags, profile, permissions] = await Promise.all([
    getSchoolBranding(locationId),
    getModuleFlags(locationId),
    getSchoolUserByUid(locationId, claims.uid),
    permissionsForRole(locationId, claims.role),
  ]);

  /*
   * The bell's badge, read here so it is correct in the first painted frame
   * rather than appearing a second later on a screen people land on six times a
   * day. One indexed count, and it needs the school-user id the profile carries,
   * so it follows rather than joining the four reads above.
   *
   * Wrapped: this table arrives in migration `0032`, and a layout runs on every
   * page of the portal. §5aw is what happens when an unguarded layout read meets
   * a schema that has not caught up — the whole portal 500s. A bell with no
   * badge is the correct degradation.
   */
  const unreadNotifications = await countUnread(profile?.id ?? null);

  const brandStyle = paletteToCSSVars(branding?.palette ?? null) as unknown as CSSProperties;

  const { items, sections } = schoolNav({
    role: claims.role,
    permissions,
    moduleFlags: moduleFlags ?? emptyModuleFlags(),
  });

  const schoolName = branding?.name ?? 'School';

  return (
    // `bg-brand-background`, not `bg-slate-50`: the page itself is one of the
    // five colours a school chooses, and painting it slate was most of why a
    // selected palette barely showed. See `lib/branding.ts`.
    <div style={brandStyle} className="bg-brand-background text-brand-text">
      <PortalFrame
        items={items}
        sections={sections}
        ariaLabel="School administration navigation"
        drawerTitle={schoolName}
        header={
          <SchoolNavbar
            schoolName={schoolName}
            logoUrl={branding?.logoUrl ?? null}
            // The platform operator has no `school_users` row here on purpose —
            // they are not a member of this school — so their address stands in
            // for the name the directory would otherwise supply.
            userName={profile?.name ?? ''}
            role={claims.role}
            schoolSlug={claims.schoolSlug}
            platformAdminEmail={claims.platformAdminEmail}
            searchResultsHref="/dashboard/search"
            unreadNotifications={unreadNotifications}
          />
        }
      >
        {children}
      </PortalFrame>
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
