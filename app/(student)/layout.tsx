import type { CSSProperties, ReactNode } from 'react';

import { ChatStreamProvider } from '@/components/chat/ChatStreamProvider';
import { PortalFrame } from '@/components/school/PortalFrame';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { StudentNavbar } from '@/components/student/StudentNavbar';
import { studentNav } from '@/components/student/student-nav';
import { paletteToCSSVars } from '@/lib/branding';
import { requireSchoolRole } from '@/lib/school-guard';
import { countUnreadNotices } from '@/lib/announcement-queries';
import { countUnreadConversations } from '@/lib/chat-queries';
import { countUnreadNotifications } from '@/lib/notifications';
import { getModuleFlags, getSchoolUserByUid } from '@/lib/school-queries';
import { headerBranchName } from '@/lib/branch-header';
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

  const unreadChats = await countChats(locationId, profile?.id ?? null);

  /*
   * Sprint 30. Which campus this reader is on, at a school that has more than
   * one. Null at a single-campus school and for an unscoped account — see
   * `lib/branch-header.ts`, which is the only place that decides it. It never
   * throws, for the same reason the counts above it do not.
   */
  const branchName = await headerBranchName({
    locationId,
    role: claims.role,
    schoolUserId: profile?.id ?? null,
    branchId: claims.branchId,
  });

  const brandStyle = paletteToCSSVars(
    branding?.palette ?? null,
  ) as unknown as CSSProperties;

  const schoolName = branding?.name ?? 'School';


  /*
   * Sprint 26. The `chat` module flag gates the Messages entry here as it has
   * always gated the administrative sidebar's — before this the flag gated one
   * portal of four, so a school with it unset showed teachers, parents and
   * pupils an inbox their own administrators could not see.
   */
  const chatEnabled = (await getModuleFlags(locationId)).chat;

  return (
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
          items={studentNav(unreadNotices, unreadChats, chatEnabled)}
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
              branchName={branchName}
              unreadNotifications={unreadNotifications}
            />
          }
        >
          {children}
        </PortalFrame>
      </ChatStreamProvider>

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

/**
 * The chat badge, or zero when it cannot be read. Never an error page.
 *
 * Wrapped for the same reason `countUnread` above it is: `chat_participants`
 * arrives in migration `0040`, this layout runs on **every** page of the
 * portal, and §5aw is what an unguarded layout read costs when the schema has
 * not caught up. A missing badge is a missing badge; a throw here is a portal
 * nobody can open.
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
