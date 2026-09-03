import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { cache } from 'react';

import { notificationPreferences, type NotificationCategory } from '@/db/schema';

import { db } from './drizzle';

/**
 * `lib/notification-preferences.ts` — what a person has asked us to stop
 * emailing them, and the one place that answers it.
 *
 * ── Absent row means everything is on ────────────────────────────────────
 * Exactly the rule `role_permissions` follows. Every account that exists today
 * has no row, and this table must not change how any of them behaves the day it
 * is created.
 *
 * ── It governs email, never the notice board ─────────────────────────────
 * Sprint 11's design is that the board is the delivery that always happens and
 * email is the push on top. A preference that could suppress the board would
 * give a school a way to have told somebody something they had no way of
 * seeing. `wantsEmail()` is therefore only ever consulted by a sender, and
 * `lib/announcement-queries.ts` calls it on the email leg alone.
 */

export interface NotificationSettings {
  announcements: boolean;
  fees: boolean;
  attendance: boolean;
  chat: boolean;
}

/** What a person gets before they have chosen anything: all of it. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  announcements: true,
  fees: true,
  attendance: true,
  chat: true,
};

/** One person's settings. Request-memoised — a page and its layout both ask. */
export const getNotificationSettings = cache(
  async (locationId: string, schoolUserId: string): Promise<NotificationSettings> => {
    const rows = await db
      .select({
        announcements: notificationPreferences.emailAnnouncements,
        fees: notificationPreferences.emailFees,
        attendance: notificationPreferences.emailAttendance,
        chat: notificationPreferences.emailChat,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.locationId, locationId),
          eq(notificationPreferences.schoolUserId, schoolUserId),
        ),
      )
      .limit(1);

    return rows[0] ?? DEFAULT_NOTIFICATION_SETTINGS;
  },
);

/**
 * Which of these people want email of this kind.
 *
 * The bulk form, and the only one a sender should use. A send to four hundred
 * parents that asked per person would be four hundred round trips — the
 * per-row-round-trip defect Sprint 10 found three times in one sprint. One
 * indexed read returns the opt-outs; everyone not named in it is opted in,
 * which is what makes the absent-row rule cheap as well as correct.
 */
/** Which column answers for each category. Exhaustive, and checked by TypeScript. */
const PREFERENCE_COLUMNS = {
  announcements: notificationPreferences.emailAnnouncements,
  fees: notificationPreferences.emailFees,
  attendance: notificationPreferences.emailAttendance,
  chat: notificationPreferences.emailChat,
} as const satisfies Record<NotificationCategory, unknown>;

export async function filterByEmailPreference(
  locationId: string,
  schoolUserIds: readonly string[],
  category: NotificationCategory,
): Promise<Set<string>> {
  const wanted = new Set(schoolUserIds);
  if (wanted.size === 0) return wanted;

  // A record rather than a chain of ternaries, and the difference is not style.
  // The chain ended in an `else` that meant `attendance`, so Sprint 24 adding a
  // fourth category would have silently filtered chat digests by whether the
  // parent wanted absence emails — a wrong answer that nothing anywhere would
  // have reported. A record makes the compiler name the gap instead.
  const column = PREFERENCE_COLUMNS[category];

  const rows = await db
    .select({
      schoolUserId: notificationPreferences.schoolUserId,
      wants: column,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.locationId, locationId),
        inArray(notificationPreferences.schoolUserId, [...wanted]),
      ),
    );

  for (const row of rows) {
    if (!row.wants) wanted.delete(row.schoolUserId);
  }

  return wanted;
}

/**
 * Writes one person's settings.
 *
 * An upsert on the (location, user) unique index, so saving twice corrects the
 * same row rather than failing or duplicating — the same shape the attendance
 * register uses, and for the same reason: this is a form somebody may submit
 * twice.
 */
export async function saveNotificationSettings(
  locationId: string,
  schoolUserId: string,
  settings: NotificationSettings,
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({
      locationId,
      schoolUserId,
      emailAnnouncements: settings.announcements,
      emailFees: settings.fees,
      emailAttendance: settings.attendance,
      emailChat: settings.chat,
    })
    .onConflictDoUpdate({
      target: [notificationPreferences.locationId, notificationPreferences.schoolUserId],
      set: {
        emailAnnouncements: settings.announcements,
        emailFees: settings.fees,
        emailAttendance: settings.attendance,
        emailChat: settings.chat,
        updatedAt: new Date(),
      },
    });
}
