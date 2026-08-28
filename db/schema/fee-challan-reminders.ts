import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { feeChallans } from './fee-challans';
import { schools } from './schools';

/**
 * fee_challan_reminders — one row per reminder actually sent about a voucher.
 *
 * ── The question it answers ──────────────────────────────────────────────
 * "Have we chased this family, and how many times?" The defaulters screen could
 * queue reminders but held no memory of having done so, so the honest answer
 * was always "somebody probably did" — which is how a parent gets four notices
 * in a week from three clerks, and how a family nobody has contacted stays
 * uncontacted while everyone assumes otherwise.
 *
 * ── `sequence`, and why it is computed inside the INSERT ─────────────────
 * The chip on the screen reads `Reminder 2 · 02-Aug-2026`, so the number has to
 * be per challan and has to be stable. Computing it as a read followed by an
 * insert — `SELECT max(sequence)`, add one, `INSERT` — is CLAUDE.md's
 * background-work mistake in a different costume: two clicks a second apart
 * both read 1 and both write 2.
 *
 * So the route writes `INSERT … SELECT coalesce(max(sequence), 0) + 1 … ON
 * CONFLICT DO NOTHING`, and **this unique index is what makes that correct**.
 * Postgres decides the collision on one row under one lock: the loser writes
 * nothing rather than a second "Reminder 2", and the reminder it was going to
 * record was the duplicate the school did not want anyway.
 *
 * ── Deliberately not a delivery log ──────────────────────────────────────
 * A row here means the school *sent* one, not that a mail server accepted it —
 * `email_outbox` owns delivery and has its own statuses. Conflating the two
 * would put a number on a chip that changes meaning depending on how far the
 * queue has got, which is not a number anybody can act on.
 */
export const feeChallanReminders = pgTable(
  'fee_challan_reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    challanId: uuid('challan_id')
      .notNull()
      .references(() => feeChallans.id, { onDelete: 'cascade' }),
    /** 1, 2, 3 … per challan. Never reused, never renumbered. */
    sequence: integer('sequence').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    /** Where it went, as it stood then. Null when nobody was reachable. */
    sentToEmail: text('sent_to_email'),
    /** Who pressed the button. Null for anything a timer sends. */
    sentByUid: text('sent_by_uid'),
  },
  (table) => [
    index('fee_challan_reminders_location_id_idx').on(table.locationId),
    index('fee_challan_reminders_challan_id_idx').on(table.challanId),
    uniqueIndex('fee_challan_reminders_challan_sequence_idx').on(
      table.challanId,
      table.sequence,
    ),
  ],
);

export type FeeChallanReminder = typeof feeChallanReminders.$inferSelect;
export type NewFeeChallanReminder = typeof feeChallanReminders.$inferInsert;
