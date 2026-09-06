import type { CSSProperties, ReactNode } from 'react';

import { ChatStreamProvider } from '@/components/chat/ChatStreamProvider';
import { PortalFrame } from '@/components/school/PortalFrame';
import { SchoolNavbar } from '@/components/school/SchoolNavbar';
import { schoolNav } from '@/components/school/school-nav';
import { paletteToCSSVars } from '@/lib/branding';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolBranding } from '@/lib/school-tenant';
import { getModuleFlags, getSchoolUserByUid } from '@/lib/school-queries';
import { countUnreadConversations } from '@/lib/chat-queries';
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

  /*
   * The Messages badge, new in Sprint 29 and absent from this portal alone
   * since Sprint 24. The parent, teacher and pupil sidebars have carried this
   * count from the day chat shipped; the administrative one — where the
   * principal, the head of campus and every clerk actually work — carried a
   * Messages link with nothing on it, so the only sign a parent had written to
   * the school office was the office deciding to go and look.
   *
   * Wrapped for the same reason the bell's count above it is: `chat_participants`
   * arrives in `0040`, this layout runs on every page of the portal, and §5aw is
   * what an unguarded layout read costs when the schema has not caught up.
   */
  const unreadChats = await countChats(locationId, profile?.id ?? null);

  const brandStyle = paletteToCSSVars(branding?.palette ?? null) as unknown as CSSProperties;

  const { items, sections } = schoolNav({
    role: claims.role,
    permissions,
    moduleFlags: moduleFlags ?? emptyModuleFlags(),
    unreadChats,
  });

  const schoolName = branding?.name ?? 'School';

  return (
    // `bg-brand-background`, not `bg-slate-50`: the page itself is one of the
    // five colours a school chooses, and painting it slate was most of why a
    // selected palette barely showed. See `lib/branding.ts`.
    <div style={brandStyle} className="bg-brand-background text-brand-text">
      {/*
        Sprint 29. One chat stream for the whole portal, mounted here rather
        than on the chat screen, which is where it lived until now and why a
        parent on any other page learned nothing when a message arrived. It
        wraps the frame rather than sitting beside it because the bell and the
        sidebar badge are inside — the refresh it fires is what moves them.

        Rendered unconditionally, including when `chat` is off: the provider's
        own fetch returns nothing useful at such a school, the poll finds an
        empty table, and gating it here would mean the flag being switched on
        did not take effect until every open tab was reloaded.
      */}
      <ChatStreamProvider>
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
      </ChatStreamProvider>
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

/**
 * The Messages badge, or zero when it cannot be read. Never an error page.
 *
 * `countUnread` above says why this shape exists; the argument is identical
 * and the table is `chat_participants`. A missing badge is a missing badge; a
 * throw here is a portal nobody can open.
 */
async function countChats(locationId: string, schoolUserId: string | null): Promise<number> {
  if (schoolUserId === null) return 0;

  try {
    return await countUnreadConversations(locationId, schoolUserId);
  } catch (error) {
    console.error('[layout] chat count could not be read:', error);
    return 0;
  }
}
