import type { CSSProperties, ReactNode } from 'react';

import { PortalFrame } from '@/components/school/PortalFrame';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { TeacherNavbar } from '@/components/teacher/TeacherNavbar';
import { teacherNav } from '@/components/teacher/teacher-nav';
import { paletteToCSSVars } from '@/lib/branding';
import { requireSchoolRole } from '@/lib/school-guard';
import { countUnreadNotices } from '@/lib/announcement-queries';
import { countUnreadConversations } from '@/lib/chat-queries';
import { countUnreadNotifications } from '@/lib/notifications';
import { listClassTeacherSections } from '@/lib/exam-queries';
import { getModuleFlags, getSchoolUserByUid } from '@/lib/school-queries';
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

  /*
   * The bell's badge. Wrapped, because `notifications` arrives in migration
   * `0032` and a layout runs on every page of this portal — §5aw is what an
   * unguarded layout read costs when the schema has not caught up.
   */
  const unreadNotifications = await countUnread(profile?.id ?? null);

  const unreadChats = await countChats(locationId, profile?.id ?? null);

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
      <PortalFrame
        items={teacherNav(
          unreadNotices,
          classTeacherSections.length > 0,
          unreadChats,
          chatEnabled,
        )}
        ariaLabel="Teacher navigation"
        drawerTitle={schoolName}
        header={
          <TeacherNavbar
            schoolName={schoolName}
            logoUrl={branding?.logoUrl ?? null}
            userName={profile?.name ?? ''}
            role={claims.role}
            schoolSlug={claims.schoolSlug}
            searchResultsHref="/teacher/search"
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
