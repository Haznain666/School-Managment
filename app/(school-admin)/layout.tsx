import type { CSSProperties, ReactNode } from 'react';

import { SchoolNavbar } from '@/components/school/SchoolNavbar';
import { SchoolSidebar } from '@/components/school/SchoolSidebar';
import { paletteToCSSVars } from '@/lib/branding';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolBranding } from '@/lib/school-tenant';
import { getModuleFlags, getSchoolUserByUid } from '@/lib/school-queries';
import { emptyModuleFlags } from '@/lib/platform-modules';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

/**
 * Administrative portal shell for school_admin, branch_admin, accountant and
 * hr_manager.
 *
 * This is where the session is actually verified — middleware only checked
 * that a cookie was present, because it runs on the Edge and cannot use
 * firebase-admin. `requireSchoolRole` redirects rather than returning when
 * access is refused, so nothing below it renders for the wrong caller.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function SchoolAdminLayout({ children }: { children: ReactNode }) {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const [branding, moduleFlags, profile] = await Promise.all([
    getSchoolBranding(locationId),
    getModuleFlags(locationId),
    getSchoolUserByUid(locationId, claims.uid),
  ]);

  const brandStyle = paletteToCSSVars(branding?.palette ?? null) as unknown as CSSProperties;

  return (
    <div style={brandStyle} className="flex h-screen bg-slate-50">
      <SchoolSidebar role={claims.role} moduleFlags={moduleFlags ?? emptyModuleFlags()} />

      <div className="flex min-w-0 flex-1 flex-col">
        <SchoolNavbar
          schoolName={branding?.name ?? 'School'}
          logoUrl={branding?.logoUrl ?? null}
          // The platform operator has no `school_users` row here on purpose —
          // they are not a member of this school — so their address stands in
          // for the name the directory would otherwise supply.
          userName={profile?.name ?? ''}
          role={claims.role}
          schoolSlug={claims.schoolSlug}
          platformAdminEmail={claims.platformAdminEmail}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
