import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { PLATFORM_MODULE_KEYS } from '@/lib/platform-modules';
import { USER_ROLES } from '@/types/school-auth';

import { schools } from './schools';

/**
 * Sprint 35 — what each school owes the platform, and what it has paid.
 *
 * Nine tables, read in this order: a school's **settings** and **rates** say
 * what a month costs; an **invoice** snapshots one month of that, as **lines**
 * less up to three **discounts**; **receipts** pay it; **emails** record who it
 * was sent to; **reminders** and **access events** are the two things the
 * sweeps do about it. The platform's own **bank accounts** are printed on all
 * of it.
 *
 * ── Money is NUMERIC(14,2) here and integer minor units in code ──────────
 * Exactly the fee module's rule (`lib/money.ts`), and for US cents as well as
 * PKR paisa: `toPaise` multiplies by one hundred, which is right for both. The
 * USD→PKR rate is NUMERIC(12,4), PKR per 1 USD.
 *
 * ── Everything on an invoice is a snapshot ───────────────────────────────
 * Rates, head counts, the conversion rate, the billable days — all copied onto
 * the invoice and its lines when it is generated. A rate changed in March must
 * not rewrite what October said, and a school disputing October is asking
 * about the document they were sent, not about today's settings.
 *
 * ── Tenancy ──────────────────────────────────────────────────────────────
 * Every table a school's data lives in carries `location_id`, indexed, per the
 * invariant in `db/schema/index.ts`. `platform_bank_accounts` is the one that
 * does not: it is the platform's own account, printed on every school's
 * invoice, and belongs to none of them.
 */

/** Roles that can carry a per-user rate. Parents are never billed (E2). */
export const BILLABLE_ROLES = USER_ROLES.filter((role) => role !== 'parent');

const roleList = BILLABLE_ROLES.map((role) => `'${role}'`).join(', ');
const moduleList = PLATFORM_MODULE_KEYS.map((key) => `'${key}'`).join(', ');

/* ═══════════════════════════════════════════════════════════ settings */

/**
 * One row per school. `0052` backfills a **sandbox** row for every school that
 * exists (E8), and a school created afterwards has no row until somebody opens
 * its Billing tab — `getBillingSettings` reads an absent row as sandbox, so
 * the two states behave identically.
 */
export const schoolBillingSettings = pgTable(
  'school_billing_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    environment: text('environment').notNull().default('sandbox'),
    /** The day the school was switched to Live. Cleared on the way back. */
    liveSince: date('live_since'),
    billingCurrency: text('billing_currency').notNull().default('USD'),
    invoiceCurrency: text('invoice_currency').notNull().default('USD'),
    /** PKR per 1 USD. Required whenever the two currencies differ. */
    usdToPkrRate: numeric('usd_to_pkr_rate', { precision: 12, scale: 4 }),
    trialDays: integer('trial_days').notNull().default(0),
    graceDays: integer('grace_days').notNull().default(2),
    /**
     * The remembered invoice recipient (E11). Sending an invoice anywhere else
     * overwrites it, so the next send defaults to wherever the last one went.
     */
    invoiceEmail: text('invoice_email'),
    updatedBy: text('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('school_billing_settings_location_id_idx').on(table.locationId),
    index('school_billing_settings_environment_idx').on(table.environment),
    check('school_billing_settings_environment_check', sql`${table.environment} IN ('sandbox', 'live')`),
    check(
      'school_billing_settings_billing_currency_check',
      sql`${table.billingCurrency} IN ('USD', 'PKR')`,
    ),
    check(
      'school_billing_settings_invoice_currency_check',
      sql`${table.invoiceCurrency} IN ('USD', 'PKR')`,
    ),
    check(
      'school_billing_settings_rate_check',
      sql`${table.billingCurrency} = ${table.invoiceCurrency} OR ${table.usdToPkrRate} > 0`,
    ),
    check('school_billing_settings_trial_check', sql`${table.trialDays} BETWEEN 0 AND 365`),
    check('school_billing_settings_grace_check', sql`${table.graceDays} BETWEEN 0 AND 60`),
    check(
      'school_billing_settings_live_check',
      sql`${table.environment} = 'live' OR ${table.liveSince} IS NULL`,
    ),
  ],
);

export const schoolRoleRates = pgTable(
  'school_role_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    /** Per user per month, in the school's billing currency. */
    monthlyRate: numeric('monthly_rate', { precision: 12, scale: 2 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('school_role_rates_location_id_idx').on(table.locationId),
    uniqueIndex('school_role_rates_location_role_idx').on(table.locationId, table.role),
    check('school_role_rates_role_check', sql.raw(`role IN (${roleList})`)),
    check('school_role_rates_rate_check', sql`${table.monthlyRate} >= 0`),
  ],
);

export const schoolModuleRates = pgTable(
  'school_module_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    moduleKey: text('module_key').notNull(),
    /** Per month, in the school's billing currency. */
    monthlyRate: numeric('monthly_rate', { precision: 12, scale: 2 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('school_module_rates_location_id_idx').on(table.locationId),
    uniqueIndex('school_module_rates_location_module_idx').on(table.locationId, table.moduleKey),
    check('school_module_rates_module_check', sql.raw(`module_key IN (${moduleList})`)),
    check('school_module_rates_rate_check', sql`${table.monthlyRate} >= 0`),
  ],
);

/* ═══════════════════════════════════════════════════════════ invoices */

export const platformInvoices = pgTable(
  'platform_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    invoiceNumber: text('invoice_number').notNull(),
    /** The billed month (E3). Always the 1st and the last day. */
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    /** The first billable day, which is after the 1st for a new school. */
    billedFrom: date('billed_from').notNull(),
    billableDays: integer('billable_days').notNull(),
    daysInPeriod: integer('days_in_period').notNull(),
    billingCurrency: text('billing_currency').notNull(),
    invoiceCurrency: text('invoice_currency').notNull(),
    /** The rate the lines were converted at. Null when no conversion. */
    conversionRate: numeric('conversion_rate', { precision: 12, scale: 4 }),
    /** In the invoice currency, from here down. */
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull(),
    discountTotal: numeric('discount_total', { precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull(),
    receivedTotal: numeric('received_total', { precision: 14, scale: 2 }).notNull().default('0'),
    status: text('status').notNull().default('draft'),
    dueDate: date('due_date').notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    finalizedBy: text('finalized_by'),
    /** When the invoice first counted as settled. Kept once set. */
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    /** The invoice this one's unpaid balance was carried into (E7). */
    carriedForwardTo: uuid('carried_forward_to').references(
      (): AnyPgColumn => platformInvoices.id,
      { onDelete: 'set null' },
    ),
    /** `sweep`, or the super admin's address for "Generate now". */
    generatedBy: text('generated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('platform_invoices_location_id_idx').on(table.locationId),
    // The claim. One invoice per school per month; a second generation is a
    // no-op `ON CONFLICT DO NOTHING`, whichever of seven processes gets there.
    uniqueIndex('platform_invoices_location_period_idx').on(table.locationId, table.periodStart),
    uniqueIndex('platform_invoices_number_idx').on(table.invoiceNumber),
    index('platform_invoices_status_due_idx').on(table.status, table.dueDate),
    check(
      'platform_invoices_status_check',
      sql`${table.status} IN ('draft', 'finalized', 'paid', 'carried_forward')`,
    ),
    check('platform_invoices_billing_currency_check', sql`${table.billingCurrency} IN ('USD', 'PKR')`),
    check('platform_invoices_invoice_currency_check', sql`${table.invoiceCurrency} IN ('USD', 'PKR')`),
    check(
      'platform_invoices_amounts_check',
      sql`${table.subtotal} >= 0 AND ${table.discountTotal} >= 0 AND ${table.discountTotal} <= ${table.subtotal} AND ${table.total} = ${table.subtotal} - ${table.discountTotal} AND ${table.receivedTotal} >= 0`,
    ),
    check(
      'platform_invoices_days_check',
      sql`${table.billableDays} BETWEEN 1 AND ${table.daysInPeriod} AND ${table.daysInPeriod} BETWEEN 28 AND 31`,
    ),
    check(
      'platform_invoices_finalized_check',
      sql`${table.status} = 'draft' OR ${table.finalizedAt} IS NOT NULL`,
    ),
  ],
);

export const platformInvoiceLines = pgTable(
  'platform_invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => platformInvoices.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    description: text('description').notNull(),
    /** For `role` lines. */
    role: text('role'),
    /** For `module` lines. */
    moduleKey: text('module_key'),
    quantity: integer('quantity').notNull().default(1),
    /** Snapshot of the monthly rate, in the billing currency. */
    unitRate: numeric('unit_rate', { precision: 12, scale: 2 }).notNull().default('0'),
    /** The prorated amount in the billing currency, before conversion. */
    billingAmount: numeric('billing_amount', { precision: 14, scale: 2 }).notNull(),
    /** What the line adds to the invoice, in the invoice currency. */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    /** For `carry_forward` lines: the invoice whose balance this is. */
    sourceInvoiceId: uuid('source_invoice_id').references(() => platformInvoices.id, {
      onDelete: 'set null',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('platform_invoice_lines_invoice_id_idx').on(table.invoiceId),
    index('platform_invoice_lines_location_id_idx').on(table.locationId),
    check(
      'platform_invoice_lines_kind_check',
      sql`${table.kind} IN ('role', 'module', 'carry_forward')`,
    ),
    check('platform_invoice_lines_amount_check', sql`${table.amount} >= 0 AND ${table.quantity} >= 0`),
  ],
);

export const platformInvoiceDiscounts = pgTable(
  'platform_invoice_discounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => platformInvoices.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Basis points, for `percent`. 1,250 is 12.5%. */
    percentBasisPoints: integer('percent_basis_points'),
    /** Minor units written as NUMERIC, for `fixed`. */
    fixedAmount: numeric('fixed_amount', { precision: 14, scale: 2 }),
    /** What it actually took off, after capping (E10). */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    description: text('description').notNull(),
    /** 1, 2 or 3 — the slot. Unique per invoice, so a fourth is a 23505. */
    position: integer('position').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('platform_invoice_discounts_location_id_idx').on(table.locationId),
    uniqueIndex('platform_invoice_discounts_slot_idx').on(table.invoiceId, table.position),
    check('platform_invoice_discounts_kind_check', sql`${table.kind} IN ('percent', 'fixed')`),
    check('platform_invoice_discounts_position_check', sql`${table.position} BETWEEN 1 AND 3`),
    check(
      'platform_invoice_discounts_value_check',
      sql`(${table.kind} = 'percent' AND ${table.percentBasisPoints} BETWEEN 1 AND 10000 AND ${table.fixedAmount} IS NULL) OR (${table.kind} = 'fixed' AND ${table.fixedAmount} > 0 AND ${table.percentBasisPoints} IS NULL)`,
    ),
    check('platform_invoice_discounts_description_check', sql`btrim(${table.description}) <> ''`),
  ],
);

export const platformInvoiceReceipts = pgTable(
  'platform_invoice_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => platformInvoices.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** In the invoice currency. */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    /** The bank's reference. Required: a receipt nobody can trace is a rumour. */
    transactionId: text('transaction_id').notNull(),
    description: text('description'),
    recordedBy: text('recorded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('platform_invoice_receipts_invoice_id_idx').on(table.invoiceId),
    index('platform_invoice_receipts_location_id_idx').on(table.locationId),
    check('platform_invoice_receipts_amount_check', sql`${table.amount} > 0`),
    check(
      'platform_invoice_receipts_transaction_check',
      sql`btrim(${table.transactionId}) <> ''`,
    ),
  ],
);

export const platformInvoiceEmails = pgTable(
  'platform_invoice_emails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => platformInvoices.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    toAddress: text('to_address').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    sentBy: text('sent_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('platform_invoice_emails_invoice_id_idx').on(table.invoiceId),
    index('platform_invoice_emails_location_id_idx').on(table.locationId),
    check('platform_invoice_emails_status_check', sql`${table.status} IN ('sent', 'failed')`),
  ],
);

/* ═══════════════════════════════════════════════════ the platform's banks */

/**
 * The accounts a school pays the platform into. Up to three, Pakistani only:
 * no SWIFT, no routing number, because nobody paying these is abroad.
 *
 * `position` 1–3 and unique, so a fourth account is a 23505 rather than a rule
 * in a route that a second route could forget.
 */
export const platformBankAccounts = pgTable(
  'platform_bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bankName: text('bank_name').notNull(),
    accountTitle: text('account_title').notNull(),
    accountNumber: text('account_number').notNull(),
    /** Stored without spaces, upper case. */
    iban: text('iban').notNull(),
    branchName: text('branch_name'),
    branchCode: text('branch_code'),
    city: text('city'),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('platform_bank_accounts_position_idx').on(table.position),
    check('platform_bank_accounts_position_check', sql`${table.position} BETWEEN 1 AND 3`),
    check('platform_bank_accounts_iban_check', sql`${table.iban} ~ '^PK[0-9]{2}[A-Z]{4}[0-9A-Z]{16}$'`),
    check(
      'platform_bank_accounts_required_check',
      sql`btrim(${table.bankName}) <> '' AND btrim(${table.accountTitle}) <> '' AND btrim(${table.accountNumber}) <> ''`,
    ),
  ],
);

/* ═══════════════════════════════════════════════════════ what the sweeps do */

/**
 * The claim for a trial reminder (§4). One row per (school, kind, trial end):
 * `INSERT … ON CONFLICT DO NOTHING RETURNING` decides which of seven processes
 * sends it — the holiday notice's shape. `trial_ends_on` is in the key so a
 * school whose trial is extended is reminded again about the new date.
 */
export const billingReminders = pgTable(
  'billing_reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    trialEndsOn: date('trial_ends_on').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('billing_reminders_location_id_idx').on(table.locationId),
    uniqueIndex('billing_reminders_claim_idx').on(table.locationId, table.kind, table.trialEndsOn),
    check('billing_reminders_kind_check', sql`${table.kind} IN ('trial_5d', 'trial_1d')`),
  ],
);

/** Every block and unblock, by whom and why. Append-only. */
export const schoolAccessEvents = pgTable(
  'school_access_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    /** `sweep`, or the super admin's address. */
    actor: text('actor').notNull(),
    invoiceId: uuid('invoice_id').references(() => platformInvoices.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('school_access_events_location_id_idx').on(table.locationId, table.createdAt),
    check('school_access_events_action_check', sql`${table.action} IN ('blocked', 'unblocked')`),
    check(
      'school_access_events_reason_check',
      sql`${table.reason} IN ('manual', 'overdue', 'payment')`,
    ),
  ],
);

export type SchoolBillingSettingsRow = typeof schoolBillingSettings.$inferSelect;
export type PlatformInvoiceRow = typeof platformInvoices.$inferSelect;
export type PlatformInvoiceLineRow = typeof platformInvoiceLines.$inferSelect;
export type PlatformBankAccountRow = typeof platformBankAccounts.$inferSelect;
