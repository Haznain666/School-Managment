import 'server-only';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { feeChallanReminders, feeChallans } from '@/db/schema';

import { db } from './drizzle';

/**
 * The record of having chased a family (Sprint 18, item 6b/6d).
 *
 * The defaulters screen could queue reminders and remembered nothing about
 * having done so, so "have we chased them?" was answered by asking whoever was
 * nearest. That produces both failure modes at once: a parent who gets four
 * notices in a week from three clerks, and a family nobody has contacted while
 * everyone assumes somebody has.
 */

/**
 * Writes one reminder against a challan and returns its sequence number.
 *
 * ── The sequence is computed inside the INSERT ───────────────────────────
 * `SELECT max(sequence)`, add one, `INSERT` is CLAUDE.md's background-work
 * mistake wearing different clothes: two clicks a second apart both read 1 and
 * both write 2. So the sub-select is *in* the statement, and the unique index
 * on (challan_id, sequence) is what decides the collision — one row, one lock,
 * one winner. `ON CONFLICT DO NOTHING` means the loser writes nothing, which is
 * the right outcome: the row it was about to write was the duplicate reminder
 * nobody wanted.
 *
 * Returns null when nothing was written, which a caller may treat as "somebody
 * else has just recorded this" and ignore.
 *
 * Never throws. It is called from the reminders route *after* the email has
 * been queued, and a bookkeeping row failing to land must not turn a sent
 * reminder into a failed request.
 */
export async function recordReminder(params: {
  locationId: string;
  challanId: string;
  sentToEmail: string | null;
  sentByUid: string | null;
}): Promise<number | null> {
  try {
    const inserted = await db
      .insert(feeChallanReminders)
      .values({
        locationId: params.locationId,
        challanId: params.challanId,
        // No operator exists for "one more than the largest so far", which is
        // the only reason this is a raw template. The interpolated value is the
        // challan id the row is already being written against.
        sequence: sql<number>`(
          select coalesce(max(${feeChallanReminders.sequence}), 0) + 1
          from ${feeChallanReminders}
          where ${feeChallanReminders.challanId} = ${params.challanId}
        )`,
        sentToEmail: params.sentToEmail,
        sentByUid: params.sentByUid,
      })
      .onConflictDoNothing()
      .returning({ sequence: feeChallanReminders.sequence });

    return inserted[0]?.sequence ?? null;
  } catch (error) {
    console.warn(
      `[fee-reminders] could not record a reminder for ${params.challanId}:`,
      error,
    );
    return null;
  }
}

/** One chip on the defaulters screen. */
export interface ReminderChip {
  sequence: number;
  /** ISO instant. The screen renders it DD-MMM-YYYY. */
  sentAt: string;
}

/**
 * Every reminder sent to each of these students, oldest first.
 *
 * Keyed by student rather than by challan because that is the row the
 * defaulters list draws: a family with three open vouchers has been chased once
 * as a family, and three separate reminder histories on one line would read as
 * three different conversations.
 */
export async function remindersForStudents(
  locationId: string,
  studentProfileIds: readonly string[],
): Promise<Map<string, ReminderChip[]>> {
  const result = new Map<string, ReminderChip[]>();
  if (studentProfileIds.length === 0) return result;

  const rows = await db
    .select({
      studentProfileId: feeChallans.studentProfileId,
      sequence: feeChallanReminders.sequence,
      sentAt: feeChallanReminders.sentAt,
    })
    .from(feeChallanReminders)
    .innerJoin(feeChallans, eq(feeChallans.id, feeChallanReminders.challanId))
    .where(
      and(
        eq(feeChallanReminders.locationId, locationId),
        inArray(feeChallans.studentProfileId, [...studentProfileIds]),
      ),
    )
    .orderBy(asc(feeChallanReminders.sentAt));

  for (const row of rows) {
    const chips = result.get(row.studentProfileId) ?? [];
    chips.push({ sequence: row.sequence, sentAt: row.sentAt.toISOString() });
    result.set(row.studentProfileId, chips);
  }

  return result;
}
