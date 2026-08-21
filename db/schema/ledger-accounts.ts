import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { LEDGER_ACCOUNT_TYPES, type LedgerAccountType, type SystemAccountKey } from '@/lib/accounting';

import { branches } from './branches';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * ledger_accounts — a school's chart of accounts (Sprint 13.5).
 *
 * One row per head the school posts to: cash, bank, fee income, salary
 * expense, and as many of its own as it wants. `lib/accounting.ts` holds the
 * twelve it starts with and the rules that decide which side each type grows
 * on; nothing about that is stored here, because a rule in a column is a rule
 * that can be edited into nonsense.
 *
 * ── Three kinds of account, one table ────────────────────────────────────
 *
 *   the school's        `system_key` null, `owner_user_id` null — a head the
 *                       school created. Editable, deactivatable, nothing in
 *                       the code refers to it by name.
 *
 *   the software's      `system_key` set — the account the code posts to when
 *                       it takes a fee payment or runs payroll. The school may
 *                       rename and re-code it; it may not delete it, because
 *                       the next payment would have nowhere to land.
 *
 *   a person's          `owner_user_id` set — a counter clerk's own cash
 *                       account. See `cash_settlements` for what it is for.
 *
 * ── Deactivated, never deleted ───────────────────────────────────────────
 * `is_active` is a filter on the pickers, not on the reports. An account that
 * has been posted to is part of the history of the school's money, and a
 * balance sheet that silently dropped a closed account would stop balancing.
 * The API refuses a delete outright rather than offering one that fails when
 * the account has entries — the second is the same refusal with worse timing.
 */
export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * The campus this head belongs to, or null for the whole school.
     *
     * Most accounts are school-wide — there is one Fee Income, not one per
     * campus. A branch's own petty cash is the case this exists for.
     */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    /** Digits only, so the chart sorts as a string exactly as it sorts as a number. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull().$type<LedgerAccountType>(),
    description: text('description'),
    /**
     * How the code finds this account. Null for a school-defined head.
     *
     * Unique per school through a *partial* index: many accounts have no
     * system key, and a plain unique constraint would allow only one of them.
     */
    systemKey: text('system_key').$type<SystemAccountKey>(),
    /**
     * The member of staff whose cash account this is, if it is one.
     *
     * `set null` rather than `cascade`: deleting a user must not delete the
     * record of the money that passed through their hands.
     */
    ownerUserId: uuid('owner_user_id').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ledger_accounts_location_id_idx').on(table.locationId),
    index('ledger_accounts_owner_user_id_idx').on(table.ownerUserId),
    uniqueIndex('ledger_accounts_location_code_idx').on(table.locationId, table.code),
    // Partial, because most accounts have no system key and a plain unique
    // constraint would then permit exactly one of them per school.
    uniqueIndex('ledger_accounts_location_system_key_idx')
      .on(table.locationId, table.systemKey)
      .where(sql`system_key IS NOT NULL`),
    // One cash account per member of staff. Two would split their takings
    // across a pair of balances and neither would be their position.
    uniqueIndex('ledger_accounts_location_owner_idx')
      .on(table.locationId, table.ownerUserId)
      .where(sql`owner_user_id IS NOT NULL`),
    check(
      'ledger_accounts_type_check',
      sql.raw(`type IN (${LEDGER_ACCOUNT_TYPES.map((type) => `'${type}'`).join(', ')})`),
    ),
    check('ledger_accounts_code_check', sql`${table.code} ~ '^[0-9]{3,8}$'`),
  ],
);

export type LedgerAccount = typeof ledgerAccounts.$inferSelect;
export type NewLedgerAccount = typeof ledgerAccounts.$inferInsert;
