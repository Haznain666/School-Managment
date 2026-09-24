import 'server-only';

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  type SQL,
} from 'drizzle-orm';

import {
  BILLABLE_ROLES,
  billingReminders,
  platformBankAccounts,
  platformInvoiceDiscounts,
  platformInvoiceEmails,
  platformInvoiceLines,
  platformInvoiceReceipts,
  platformInvoices,
  schoolAccessEvents,
  schoolBillingSettings,
  schoolModuleRates,
  schoolModules,
  schoolRoleRates,
  schoolUsers,
  schools,
} from '@/db/schema';
import { ROLE_LABELS } from '@/types/school-auth';

import { db, type Tx } from './drizzle';
import { enqueueEmail } from './email-outbox';
import { serverEnv } from './env';
import { formatMoneyMinor, paiseToNumeric, toPaise } from './money';
import {
  addDays,
  applyDiscounts,
  billablePeriod,
  compareDates,
  convertMinor,
  daysInclusive,
  DEFAULT_GRACE_DAYS,
  dueDateForPeriod,
  INVOICE_DISPLAY_LABELS,
  invoiceDisplayStatus,
  invoiceNumberFor,
  isBillingCurrency,
  karachiToday,
  lastOfMonth,
  MAX_DISCOUNTS_PER_INVOICE,
  monthLabel,
  previousMonth,
  prorate,
  rateToUnits,
  shortDate,
  trialEndsOn,
  type BillingCurrency,
  type BillingEnvironment,
  type DiscountKind,
  type InvoiceDisplayStatus,
  type InvoiceStatus,
} from './platform-billing';
import { isInvoiceCleared } from './platform-invoice-clearing';
import {
  ALWAYS_ON_MODULE_KEYS,
  isAlwaysOnModule,
  PLATFORM_MODULES,
  type PlatformModuleKey,
} from './platform-modules';
import { isStudentCredentialAddress } from './student-credentials';

/**
 * Platform billing, against the database — Sprint 35, §2–§6.
 *
 * The arithmetic is in `lib/platform-billing.ts` and is pure; the one rule that
 * must never reach a browser is in `lib/platform-invoice-clearing.ts`. This
 * file is the reads, the writes, and the three sweeps.
 *
 * ── Every write that moves an invoice is claimed ─────────────────────────
 * CLAUDE.md, "background work is claimed, not checked", and it applies to the
 * operator's buttons as much as to the sweeps: two tabs pressing Finalize, or a
 * sweep generating while an operator presses "Generate now", must produce one
 * outcome. Generation is an `INSERT … ON CONFLICT DO NOTHING RETURNING` on the
 * (school, month) unique index; finalizing is `UPDATE … WHERE status = 'draft'
 * RETURNING`; a receipt locks its invoice row `FOR UPDATE` before it reads the
 * received total; a block is `UPDATE schools … WHERE access_blocked_at IS NULL
 * RETURNING`. In each case Postgres decides, on one row, under one lock.
 *
 * ── Every statement in a transaction is built on `tx` ────────────────────
 * A builder made from `db` runs outside the transaction even when awaited
 * inside it (CLAUDE.md's conventions table). Every function below that opens
 * one takes the `tx` it is given and nothing else.
 */

/* ═══════════════════════════════════════════════════════════ settings */

export interface BillingSettings {
  locationId: string;
  environment: BillingEnvironment;
  liveSince: string | null;
  billingCurrency: BillingCurrency;
  invoiceCurrency: BillingCurrency;
  /** PKR per 1 USD, as stored. */
  usdToPkrRate: string | null;
  trialDays: number;
  graceDays: number;
  /** The last free day, derived (E4). */
  trialEndsOn: string | null;
  invoiceEmail: string | null;
}

function settingsFromRow(
  locationId: string,
  row: typeof schoolBillingSettings.$inferSelect | undefined,
): BillingSettings {
  if (row === undefined) {
    // A school created after `0052` with nobody having opened its Billing tab.
    // Sandbox, exactly as the backfill would have made it (E8).
    return {
      locationId,
      environment: 'sandbox',
      liveSince: null,
      billingCurrency: 'USD',
      invoiceCurrency: 'USD',
      usdToPkrRate: null,
      trialDays: 0,
      graceDays: DEFAULT_GRACE_DAYS,
      trialEndsOn: null,
      invoiceEmail: null,
    };
  }

  const environment: BillingEnvironment = row.environment === 'live' ? 'live' : 'sandbox';
  const liveSince = environment === 'live' ? row.liveSince : null;

  return {
    locationId,
    environment,
    liveSince,
    billingCurrency: isBillingCurrency(row.billingCurrency) ? row.billingCurrency : 'USD',
    invoiceCurrency: isBillingCurrency(row.invoiceCurrency) ? row.invoiceCurrency : 'USD',
    usdToPkrRate: row.usdToPkrRate,
    trialDays: row.trialDays,
    graceDays: row.graceDays,
    trialEndsOn: trialEndsOn(liveSince, row.trialDays),
    invoiceEmail: row.invoiceEmail,
  };
}

export async function getBillingSettings(locationId: string): Promise<BillingSettings> {
  const rows = await db
    .select()
    .from(schoolBillingSettings)
    .where(eq(schoolBillingSettings.locationId, locationId))
    .limit(1);
  return settingsFromRow(locationId, rows[0]);
}

/**
 * What a freshly created school starts with: a sandbox settings row and the
 * three Phase 1 modules switched on — the same state `0052` gave every school
 * that existed when it ran, so a school made on Tuesday is indistinguishable
 * from one made the week before.
 */
export async function seedSchoolBillingDefaults(locationId: string): Promise<void> {
  const now = new Date();
  await db.insert(schoolBillingSettings).values({ locationId }).onConflictDoNothing();
  await db
    .insert(schoolModules)
    .values(
      ALWAYS_ON_MODULE_KEYS.map((key) => ({
        locationId,
        moduleKey: key,
        isEnabled: true,
        enabledAt: now,
        enabledBy: 'school creation',
      })),
    )
    .onConflictDoNothing();
}

/* ═══════════════════════════════════════════════════════════ user counts */

export type RoleCounts = Partial<Record<string, number>>;

/**
 * Billable users per school, per role (E2) — **one grouped query for the whole
 * list**, never one per school (§1).
 *
 * Active `school_users` rows whose role is not `parent`, counted at the moment
 * of asking. A person with rows at two schools counts at each, which is what
 * each school is being billed for.
 */
export async function billableUserCounts(
  locationIds: readonly string[],
): Promise<Map<string, RoleCounts>> {
  const result = new Map<string, RoleCounts>();
  if (locationIds.length === 0) return result;

  const rows = await db
    .select({
      locationId: schoolUsers.locationId,
      role: schoolUsers.role,
      users: count(),
    })
    .from(schoolUsers)
    .where(
      and(
        inArray(schoolUsers.locationId, [...locationIds]),
        eq(schoolUsers.isActive, true),
        ne(schoolUsers.role, 'parent'),
      ),
    )
    .groupBy(schoolUsers.locationId, schoolUsers.role);

  for (const row of rows) {
    const entry = result.get(row.locationId) ?? {};
    entry[row.role] = Number(row.users);
    result.set(row.locationId, entry);
  }

  return result;
}

export function totalUsers(counts: RoleCounts | undefined): number {
  if (counts === undefined) return 0;
  return Object.values(counts).reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

/* ═══════════════════════════════════════════════════════════ the tab */

export interface BillingRoleRow {
  role: string;
  label: string;
  count: number;
  /** Minor units per user per month, billing currency. */
  rateMinor: number;
}

export interface BillingModuleRow {
  key: PlatformModuleKey;
  label: string;
  enabled: boolean;
  included: boolean;
  rateMinor: number;
}

export interface BillingInvoiceSummary {
  id: string;
  invoiceNumber: string;
  periodStart: string;
  currency: BillingCurrency;
  totalMinor: number;
  receivedMinor: number;
  status: InvoiceDisplayStatus;
  statusLabel: string;
  dueDate: string;
}

export interface SchoolBillingOverview {
  school: {
    id: string;
    name: string;
    slug: string;
    locationId: string;
    accessBlockedAt: string | null;
  };
  settings: BillingSettings;
  roles: BillingRoleRow[];
  modules: BillingModuleRow[];
  invoices: BillingInvoiceSummary[];
  adminEmail: string | null;
  events: { action: string; reason: string; actor: string; at: string }[];
  today: string;
}

export async function getSchoolBillingOverview(
  schoolId: string,
): Promise<SchoolBillingOverview | null> {
  const schoolRows = await db
    .select({
      id: schools.id,
      name: schools.name,
      slug: schools.slug,
      locationId: schools.locationId,
      accessBlockedAt: schools.accessBlockedAt,
    })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);

  const school = schoolRows[0];
  if (school === undefined) return null;

  const locationId = school.locationId;

  const [settings, counts, roleRates, moduleRows, moduleRates, invoices, adminEmail, events] =
    await Promise.all([
      getBillingSettings(locationId),
      billableUserCounts([locationId]),
      db
        .select({ role: schoolRoleRates.role, monthlyRate: schoolRoleRates.monthlyRate })
        .from(schoolRoleRates)
        .where(eq(schoolRoleRates.locationId, locationId)),
      db
        .select({ moduleKey: schoolModules.moduleKey, isEnabled: schoolModules.isEnabled })
        .from(schoolModules)
        .where(eq(schoolModules.locationId, locationId)),
      db
        .select({ moduleKey: schoolModuleRates.moduleKey, monthlyRate: schoolModuleRates.monthlyRate })
        .from(schoolModuleRates)
        .where(eq(schoolModuleRates.locationId, locationId)),
      listPlatformInvoices({ locationId, limit: 24 }),
      schoolAdminEmail(locationId),
      db
        .select({
          action: schoolAccessEvents.action,
          reason: schoolAccessEvents.reason,
          actor: schoolAccessEvents.actor,
          createdAt: schoolAccessEvents.createdAt,
        })
        .from(schoolAccessEvents)
        .where(eq(schoolAccessEvents.locationId, locationId))
        .orderBy(desc(schoolAccessEvents.createdAt))
        .limit(10),
    ]);

  const roleCounts = counts.get(locationId) ?? {};
  const rateByRole = new Map(roleRates.map((row) => [row.role, toPaise(row.monthlyRate)]));
  const rateByModule = new Map(moduleRates.map((row) => [row.moduleKey, toPaise(row.monthlyRate)]));
  const enabledModules = new Set(moduleRows.filter((row) => row.isEnabled).map((row) => row.moduleKey));

  return {
    school: {
      id: school.id,
      name: school.name,
      slug: school.slug,
      locationId,
      accessBlockedAt: school.accessBlockedAt?.toISOString() ?? null,
    },
    settings,
    roles: BILLABLE_ROLES.map((role) => ({
      role,
      label: ROLE_LABELS[role],
      count: roleCounts[role] ?? 0,
      rateMinor: rateByRole.get(role) ?? 0,
    })),
    modules: PLATFORM_MODULES.map((entry) => ({
      key: entry.key,
      label: entry.label,
      included: isAlwaysOnModule(entry.key),
      enabled: isAlwaysOnModule(entry.key) || enabledModules.has(entry.key),
      rateMinor: rateByModule.get(entry.key) ?? 0,
    })),
    invoices,
    adminEmail,
    events: events.map((event) => ({
      action: event.action,
      reason: event.reason,
      actor: event.actor,
      at: event.createdAt.toISOString(),
    })),
    today: karachiToday(new Date()),
  };
}

export interface BillingSettingsInput {
  environment: BillingEnvironment;
  billingCurrency: BillingCurrency;
  invoiceCurrency: BillingCurrency;
  usdToPkrRate: string | null;
  trialDays: number;
  graceDays: number;
  invoiceEmail: string | null;
  /** Minor units, billing currency. Roles absent here keep their rate. */
  roleRates: Partial<Record<string, number>>;
  moduleRates: Partial<Record<string, number>>;
}

/**
 * Saves the Billing tab in one transaction.
 *
 * `live_since` is the one field the operator does not type: it is stamped with
 * today (Karachi) on the save that moves a school from Sandbox to Live, and
 * cleared on the save that moves it back (E8). Re-saving a Live school leaves
 * it alone, so the trial does not restart every time a rate is edited.
 */
export async function saveBillingSettings(
  locationId: string,
  input: BillingSettingsInput,
  actorEmail: string,
): Promise<void> {
  const current = await getBillingSettings(locationId);
  const today = karachiToday(new Date());

  const liveSince =
    input.environment === 'live'
      ? current.environment === 'live' && current.liveSince !== null
        ? current.liveSince
        : today
      : null;

  const now = new Date();

  const roleEntries = Object.entries(input.roleRates).filter(
    (entry): entry is [string, number] =>
      entry[1] !== undefined && (BILLABLE_ROLES as readonly string[]).includes(entry[0]),
  );
  const moduleEntries = Object.entries(input.moduleRates).filter(
    (entry): entry is [string, number] =>
      entry[1] !== undefined &&
      PLATFORM_MODULES.some((module) => module.key === entry[0]) &&
      !isAlwaysOnModule(entry[0]),
  );

  await db.transaction(async (tx) => {
    await tx
      .insert(schoolBillingSettings)
      .values({
        locationId,
        environment: input.environment,
        liveSince,
        billingCurrency: input.billingCurrency,
        invoiceCurrency: input.invoiceCurrency,
        usdToPkrRate: input.usdToPkrRate,
        trialDays: input.trialDays,
        graceDays: input.graceDays,
        invoiceEmail: input.invoiceEmail,
        updatedBy: actorEmail,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schoolBillingSettings.locationId,
        set: {
          environment: input.environment,
          liveSince,
          billingCurrency: input.billingCurrency,
          invoiceCurrency: input.invoiceCurrency,
          usdToPkrRate: input.usdToPkrRate,
          trialDays: input.trialDays,
          graceDays: input.graceDays,
          invoiceEmail: input.invoiceEmail,
          updatedBy: actorEmail,
          updatedAt: now,
        },
      });

    for (const [role, minor] of roleEntries) {
      await tx
        .insert(schoolRoleRates)
        .values({ locationId, role, monthlyRate: paiseToNumeric(minor), updatedAt: now })
        .onConflictDoUpdate({
          target: [schoolRoleRates.locationId, schoolRoleRates.role],
          set: { monthlyRate: paiseToNumeric(minor), updatedAt: now },
        });
    }

    for (const [moduleKey, minor] of moduleEntries) {
      await tx
        .insert(schoolModuleRates)
        .values({ locationId, moduleKey, monthlyRate: paiseToNumeric(minor), updatedAt: now })
        .onConflictDoUpdate({
          target: [schoolModuleRates.locationId, schoolModuleRates.moduleKey],
          set: { monthlyRate: paiseToNumeric(minor), updatedAt: now },
        });
    }
  });
}

/* ═══════════════════════════════════════════════════════════ generation */

export type GenerationOutcome =
  | { status: 'created'; invoiceId: string; invoiceNumber: string }
  | { status: 'exists'; invoiceId: string | null }
  | { status: 'not_live' }
  | { status: 'no_billable_days' }
  | { status: 'missing_rate' }
  | { status: 'not_found' };

interface DraftLine {
  kind: 'role' | 'module' | 'carry_forward';
  description: string;
  role: string | null;
  moduleKey: string | null;
  quantity: number;
  unitRateMinor: number;
  billingAmountMinor: number;
  amountMinor: number;
  sourceInvoiceId: string | null;
}

/**
 * Raises the draft invoice for one school and one billed month (§5, E3, E7).
 *
 * The sweep and the "Generate now" button call this and nothing else, which is
 * how QA exercises exactly what the 1st of the month will do.
 *
 * In one transaction:
 *   1. read the settings, the head counts, the rates and the enabled modules;
 *   2. lock every earlier invoice that still has a balance and has not been
 *      carried (`FOR UPDATE`), so two generations cannot both carry it;
 *   3. insert the invoice — the claim. A conflict on (school, month) means
 *      somebody else already raised it, and nothing else is written;
 *   4. insert the lines, and mark the carried invoices `carried_forward`.
 */
export async function generateInvoiceForSchool(
  locationId: string,
  periodStart: string,
  generatedBy: string,
): Promise<GenerationOutcome> {
  const period = { start: periodStart, end: lastOfMonth(periodStart) };

  return db.transaction(async (tx) => {
    const schoolRows = await tx
      .select({ slug: schools.slug })
      .from(schools)
      .where(eq(schools.locationId, locationId))
      .limit(1);
    const school = schoolRows[0];
    if (school === undefined) return { status: 'not_found' } as const;

    const existing = await tx
      .select({ id: platformInvoices.id })
      .from(platformInvoices)
      .where(
        and(eq(platformInvoices.locationId, locationId), eq(platformInvoices.periodStart, period.start)),
      )
      .limit(1);
    if (existing[0] !== undefined) return { status: 'exists', invoiceId: existing[0].id } as const;

    const settingsRows = await tx
      .select()
      .from(schoolBillingSettings)
      .where(eq(schoolBillingSettings.locationId, locationId))
      .limit(1);
    const settings = settingsFromRow(locationId, settingsRows[0]);

    if (settings.environment !== 'live' || settings.liveSince === null) {
      return { status: 'not_live' } as const;
    }

    const window = billablePeriod(period.start, settings.liveSince, settings.trialEndsOn);
    if (window === null) return { status: 'no_billable_days' } as const;

    const rateUnits = rateToUnits(settings.usdToPkrRate);
    if (settings.billingCurrency !== settings.invoiceCurrency && rateUnits === null) {
      return { status: 'missing_rate' } as const;
    }

    const convert = (minor: number) =>
      convertMinor(minor, settings.billingCurrency, settings.invoiceCurrency, rateUnits);

    const counts = await tx
      .select({ role: schoolUsers.role, users: count() })
      .from(schoolUsers)
      .where(
        and(
          eq(schoolUsers.locationId, locationId),
          eq(schoolUsers.isActive, true),
          ne(schoolUsers.role, 'parent'),
        ),
      )
      .groupBy(schoolUsers.role);
    const roleRates = await tx
      .select({ role: schoolRoleRates.role, monthlyRate: schoolRoleRates.monthlyRate })
      .from(schoolRoleRates)
      .where(eq(schoolRoleRates.locationId, locationId));
    const moduleRows = await tx
      .select({ moduleKey: schoolModules.moduleKey })
      .from(schoolModules)
      .where(and(eq(schoolModules.locationId, locationId), eq(schoolModules.isEnabled, true)));
    const moduleRates = await tx
      .select({ moduleKey: schoolModuleRates.moduleKey, monthlyRate: schoolModuleRates.monthlyRate })
      .from(schoolModuleRates)
      .where(eq(schoolModuleRates.locationId, locationId));

    const countByRole = new Map(counts.map((row) => [row.role, Number(row.users)]));
    const lines: DraftLine[] = [];
    const days = `${String(window.billableDays)}/${String(window.daysInMonth)} days`;

    for (const role of BILLABLE_ROLES) {
      const rate = roleRates.find((row) => row.role === role);
      const rateMinor = toPaise(rate?.monthlyRate);
      const quantity = countByRole.get(role) ?? 0;
      if (rateMinor <= 0 || quantity <= 0) continue;

      const billingAmountMinor = prorate(quantity * rateMinor, window.billableDays, window.daysInMonth);
      lines.push({
        kind: 'role',
        description:
          window.billableDays === window.daysInMonth
            ? `${ROLE_LABELS[role]} users`
            : `${ROLE_LABELS[role]} users (${days})`,
        role,
        moduleKey: null,
        quantity,
        unitRateMinor: rateMinor,
        billingAmountMinor,
        amountMinor: convert(billingAmountMinor),
        sourceInvoiceId: null,
      });
    }

    const enabled = new Set(moduleRows.map((row) => row.moduleKey));
    for (const entry of PLATFORM_MODULES) {
      if (isAlwaysOnModule(entry.key) || !enabled.has(entry.key)) continue;
      const rateMinor = toPaise(moduleRates.find((row) => row.moduleKey === entry.key)?.monthlyRate);
      if (rateMinor <= 0) continue;

      const billingAmountMinor = prorate(rateMinor, window.billableDays, window.daysInMonth);
      lines.push({
        kind: 'module',
        description:
          window.billableDays === window.daysInMonth
            ? `${entry.label} module`
            : `${entry.label} module (${days})`,
        role: null,
        moduleKey: entry.key,
        quantity: 1,
        unitRateMinor: rateMinor,
        billingAmountMinor,
        amountMinor: convert(billingAmountMinor),
        sourceInvoiceId: null,
      });
    }

    /* Carry-forward (E7). Locked, so a concurrent generation waits here. */
    const earlier = await tx
      .select({
        id: platformInvoices.id,
        invoiceNumber: platformInvoices.invoiceNumber,
        total: platformInvoices.total,
        receivedTotal: platformInvoices.receivedTotal,
        invoiceCurrency: platformInvoices.invoiceCurrency,
      })
      .from(platformInvoices)
      .where(
        and(
          eq(platformInvoices.locationId, locationId),
          inArray(platformInvoices.status, ['finalized', 'paid']),
          isNull(platformInvoices.carriedForwardTo),
          lt(platformInvoices.periodStart, period.start),
        ),
      )
      .orderBy(asc(platformInvoices.periodStart))
      .for('update');

    const carried: string[] = [];
    for (const invoice of earlier) {
      const balance = toPaise(invoice.total) - toPaise(invoice.receivedTotal);
      if (balance <= 0) continue;

      const from = isBillingCurrency(invoice.invoiceCurrency) ? invoice.invoiceCurrency : 'USD';
      let amountMinor = balance;
      let description = `Previous balance (${invoice.invoiceNumber})`;

      if (from !== settings.invoiceCurrency) {
        if (rateUnits === null) return { status: 'missing_rate' } as const;
        amountMinor = convertMinor(balance, from, settings.invoiceCurrency, rateUnits);
        description += `, converted from ${formatMoneyMinor(balance, from)} at ${String(
          settings.usdToPkrRate,
        )} PKR per USD`;
      }

      carried.push(invoice.id);
      lines.push({
        kind: 'carry_forward',
        description,
        role: null,
        moduleKey: null,
        quantity: 1,
        unitRateMinor: 0,
        billingAmountMinor: amountMinor,
        amountMinor,
        sourceInvoiceId: invoice.id,
      });
    }

    const subtotal = lines.reduce((sum, line) => sum + line.amountMinor, 0);

    const inserted = await tx
      .insert(platformInvoices)
      .values({
        locationId,
        invoiceNumber: invoiceNumberFor(period.start, school.slug),
        periodStart: period.start,
        periodEnd: period.end,
        billedFrom: window.from,
        billableDays: window.billableDays,
        daysInPeriod: window.daysInMonth,
        billingCurrency: settings.billingCurrency,
        invoiceCurrency: settings.invoiceCurrency,
        conversionRate:
          settings.billingCurrency === settings.invoiceCurrency ? null : settings.usdToPkrRate,
        subtotal: paiseToNumeric(subtotal),
        discountTotal: '0.00',
        total: paiseToNumeric(subtotal),
        receivedTotal: '0.00',
        status: 'draft',
        dueDate: dueDateForPeriod(period.start),
        generatedBy,
      })
      .onConflictDoNothing()
      .returning({ id: platformInvoices.id, invoiceNumber: platformInvoices.invoiceNumber });

    const invoice = inserted[0];
    if (invoice === undefined) return { status: 'exists', invoiceId: null } as const;

    if (lines.length > 0) {
      await tx.insert(platformInvoiceLines).values(
        lines.map((line, index) => ({
          invoiceId: invoice.id,
          locationId,
          kind: line.kind,
          description: line.description,
          role: line.role,
          moduleKey: line.moduleKey,
          quantity: line.quantity,
          unitRate: paiseToNumeric(line.unitRateMinor),
          billingAmount: paiseToNumeric(line.billingAmountMinor),
          amount: paiseToNumeric(line.amountMinor),
          sourceInvoiceId: line.sourceInvoiceId,
          sortOrder: index,
        })),
      );
    }

    if (carried.length > 0) {
      await tx
        .update(platformInvoices)
        .set({ status: 'carried_forward', carriedForwardTo: invoice.id, updatedAt: new Date() })
        .where(and(inArray(platformInvoices.id, carried), isNull(platformInvoices.carriedForwardTo)));
    }

    return { status: 'created', invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber } as const;
  });
}

/** The month the sweep and the button both bill: the one before today's. */
export function billedMonthFor(now: Date): { start: string; end: string } {
  return previousMonth(karachiToday(now));
}

/* ═══════════════════════════════════════════════════════════ listing */

export interface InvoiceListFilters {
  locationId?: string;
  status?: InvoiceDisplayStatus;
  /** `YYYY-MM`, the billed month. */
  month?: string;
  limit?: number;
}

export interface InvoiceListRow extends BillingInvoiceSummary {
  schoolId: string;
  schoolName: string;
  locationId: string;
}

export async function listPlatformInvoices(
  filters: InvoiceListFilters = {},
): Promise<InvoiceListRow[]> {
  const today = karachiToday(new Date());
  const conditions: SQL[] = [];

  if (filters.locationId !== undefined) {
    conditions.push(eq(platformInvoices.locationId, filters.locationId));
  }
  if (filters.month !== undefined && /^\d{4}-\d{2}$/.test(filters.month)) {
    conditions.push(eq(platformInvoices.periodStart, `${filters.month}-01`));
  }

  switch (filters.status) {
    case 'draft':
      conditions.push(eq(platformInvoices.status, 'draft'));
      break;
    case 'paid':
      conditions.push(eq(platformInvoices.status, 'paid'));
      break;
    case 'carried_forward':
      conditions.push(eq(platformInvoices.status, 'carried_forward'));
      break;
    case 'due':
      conditions.push(eq(platformInvoices.status, 'finalized'), gte(platformInvoices.dueDate, today));
      break;
    case 'overdue':
      conditions.push(eq(platformInvoices.status, 'finalized'), lt(platformInvoices.dueDate, today));
      break;
    default:
      break;
  }

  const rows = await db
    .select({
      id: platformInvoices.id,
      invoiceNumber: platformInvoices.invoiceNumber,
      periodStart: platformInvoices.periodStart,
      invoiceCurrency: platformInvoices.invoiceCurrency,
      total: platformInvoices.total,
      receivedTotal: platformInvoices.receivedTotal,
      status: platformInvoices.status,
      dueDate: platformInvoices.dueDate,
      locationId: platformInvoices.locationId,
      schoolId: schools.id,
      schoolName: schools.name,
    })
    .from(platformInvoices)
    .innerJoin(schools, eq(schools.locationId, platformInvoices.locationId))
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(platformInvoices.periodStart), asc(schools.name))
    .limit(Math.min(Math.max(filters.limit ?? 200, 1), 500));

  return rows.map((row) => {
    const status = invoiceDisplayStatus(row.status as InvoiceStatus, row.dueDate, today);
    return {
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      periodStart: row.periodStart,
      currency: isBillingCurrency(row.invoiceCurrency) ? row.invoiceCurrency : 'USD',
      totalMinor: toPaise(row.total),
      receivedMinor: toPaise(row.receivedTotal),
      status,
      statusLabel: INVOICE_DISPLAY_LABELS[status],
      dueDate: row.dueDate,
      schoolId: row.schoolId,
      schoolName: row.schoolName,
      locationId: row.locationId,
    };
  });
}

/* ═══════════════════════════════════════════════════════════ one invoice */

export interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  locationId: string;
  school: {
    id: string;
    name: string;
    city: string;
    address: string | null;
    email: string | null;
    accessBlockedAt: string | null;
  };
  periodStart: string;
  periodEnd: string;
  billedFrom: string;
  billableDays: number;
  daysInPeriod: number;
  billingCurrency: BillingCurrency;
  currency: BillingCurrency;
  conversionRate: string | null;
  subtotalMinor: number;
  discountTotalMinor: number;
  totalMinor: number;
  receivedMinor: number;
  balanceMinor: number;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  statusLabel: string;
  dueDate: string;
  createdAt: string;
  finalizedAt: string | null;
  finalizedBy: string | null;
  carriedForwardTo: { id: string; invoiceNumber: string } | null;
  lines: {
    id: string;
    kind: string;
    description: string;
    quantity: number;
    unitRateMinor: number;
    amountMinor: number;
  }[];
  discounts: {
    id: string;
    kind: DiscountKind;
    percentBasisPoints: number | null;
    fixedMinor: number | null;
    amountMinor: number;
    description: string;
    position: number;
  }[];
  receipts: {
    id: string;
    amountMinor: number;
    transactionId: string;
    description: string | null;
    recordedBy: string;
    createdAt: string;
  }[];
  emails: { id: string; to: string; status: string; error: string | null; sentBy: string; at: string }[];
  defaultRecipient: string | null;
}

export async function getPlatformInvoiceDetail(invoiceId: string): Promise<InvoiceDetail | null> {
  const rows = await db
    .select({
      invoice: platformInvoices,
      schoolId: schools.id,
      schoolName: schools.name,
      schoolCity: schools.city,
      schoolAddress: schools.address,
      schoolEmail: schools.email,
      accessBlockedAt: schools.accessBlockedAt,
    })
    .from(platformInvoices)
    .innerJoin(schools, eq(schools.locationId, platformInvoices.locationId))
    .where(eq(platformInvoices.id, invoiceId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;
  const invoice = row.invoice;

  const [lines, discounts, receipts, emails, carriedInto, recipient] = await Promise.all([
    db
      .select()
      .from(platformInvoiceLines)
      .where(eq(platformInvoiceLines.invoiceId, invoiceId))
      .orderBy(asc(platformInvoiceLines.sortOrder)),
    db
      .select()
      .from(platformInvoiceDiscounts)
      .where(eq(platformInvoiceDiscounts.invoiceId, invoiceId))
      .orderBy(asc(platformInvoiceDiscounts.position)),
    db
      .select()
      .from(platformInvoiceReceipts)
      .where(eq(platformInvoiceReceipts.invoiceId, invoiceId))
      .orderBy(asc(platformInvoiceReceipts.createdAt)),
    db
      .select()
      .from(platformInvoiceEmails)
      .where(eq(platformInvoiceEmails.invoiceId, invoiceId))
      .orderBy(desc(platformInvoiceEmails.createdAt)),
    invoice.carriedForwardTo === null
      ? Promise.resolve([])
      : db
          .select({ id: platformInvoices.id, invoiceNumber: platformInvoices.invoiceNumber })
          .from(platformInvoices)
          .where(eq(platformInvoices.id, invoice.carriedForwardTo))
          .limit(1),
    defaultInvoiceRecipient(invoice.locationId),
  ]);

  const today = karachiToday(new Date());
  const status = invoice.status as InvoiceStatus;
  const displayStatus = invoiceDisplayStatus(status, invoice.dueDate, today);
  const totalMinor = toPaise(invoice.total);
  const receivedMinor = toPaise(invoice.receivedTotal);

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    locationId: invoice.locationId,
    school: {
      id: row.schoolId,
      name: row.schoolName,
      city: row.schoolCity,
      address: row.schoolAddress,
      email: row.schoolEmail,
      accessBlockedAt: row.accessBlockedAt?.toISOString() ?? null,
    },
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    billedFrom: invoice.billedFrom,
    billableDays: invoice.billableDays,
    daysInPeriod: invoice.daysInPeriod,
    billingCurrency: isBillingCurrency(invoice.billingCurrency) ? invoice.billingCurrency : 'USD',
    currency: isBillingCurrency(invoice.invoiceCurrency) ? invoice.invoiceCurrency : 'USD',
    conversionRate: invoice.conversionRate,
    subtotalMinor: toPaise(invoice.subtotal),
    discountTotalMinor: toPaise(invoice.discountTotal),
    totalMinor,
    receivedMinor,
    balanceMinor: Math.max(0, totalMinor - receivedMinor),
    status,
    displayStatus,
    statusLabel: INVOICE_DISPLAY_LABELS[displayStatus],
    dueDate: invoice.dueDate,
    createdAt: invoice.createdAt.toISOString(),
    finalizedAt: invoice.finalizedAt?.toISOString() ?? null,
    finalizedBy: invoice.finalizedBy,
    carriedForwardTo: carriedInto[0] ?? null,
    lines: lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      description: line.description,
      quantity: line.quantity,
      unitRateMinor: toPaise(line.unitRate),
      amountMinor: toPaise(line.amount),
    })),
    discounts: discounts.map((discount) => ({
      id: discount.id,
      kind: discount.kind === 'fixed' ? 'fixed' : 'percent',
      percentBasisPoints: discount.percentBasisPoints,
      fixedMinor: discount.fixedAmount === null ? null : toPaise(discount.fixedAmount),
      amountMinor: toPaise(discount.amount),
      description: discount.description,
      position: discount.position,
    })),
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      amountMinor: toPaise(receipt.amount),
      transactionId: receipt.transactionId,
      description: receipt.description,
      recordedBy: receipt.recordedBy,
      createdAt: receipt.createdAt.toISOString(),
    })),
    emails: emails.map((email) => ({
      id: email.id,
      to: email.toAddress,
      status: email.status,
      error: email.error,
      sentBy: email.sentBy,
      at: email.createdAt.toISOString(),
    })),
    defaultRecipient: recipient,
  };
}

/* ═══════════════════════════════════════════════════════════ discounts */

export type InvoiceWriteOutcome =
  | { ok: true }
  | { ok: false; code: 'not_found' | 'not_draft' | 'too_many' | 'not_payable' | 'over_balance'; message: string };

/**
 * Re-prices every discount on a draft and writes the invoice totals.
 * Called inside the transaction that changed the set, on its `tx`.
 */
async function repriceDiscounts(tx: Tx, invoiceId: string): Promise<void> {
  const invoiceRows = await tx
    .select({ subtotal: platformInvoices.subtotal })
    .from(platformInvoices)
    .where(eq(platformInvoices.id, invoiceId))
    .limit(1);
  const subtotal = toPaise(invoiceRows[0]?.subtotal);

  const discounts = await tx
    .select()
    .from(platformInvoiceDiscounts)
    .where(eq(platformInvoiceDiscounts.invoiceId, invoiceId))
    .orderBy(asc(platformInvoiceDiscounts.position));

  const priced = applyDiscounts(
    subtotal,
    discounts.map((discount) =>
      discount.kind === 'fixed'
        ? { kind: 'fixed' as const, value: toPaise(discount.fixedAmount) }
        : { kind: 'percent' as const, value: discount.percentBasisPoints ?? 0 },
    ),
  );

  for (const [index, discount] of discounts.entries()) {
    await tx
      .update(platformInvoiceDiscounts)
      .set({ amount: paiseToNumeric(priced.amounts[index] ?? 0) })
      .where(eq(platformInvoiceDiscounts.id, discount.id));
  }

  await tx
    .update(platformInvoices)
    .set({
      discountTotal: paiseToNumeric(priced.totalDiscount),
      total: paiseToNumeric(priced.total),
      updatedAt: new Date(),
    })
    .where(eq(platformInvoices.id, invoiceId));
}

export async function addInvoiceDiscount(
  invoiceId: string,
  input: { kind: DiscountKind; value: number; description: string },
  actorEmail: string,
): Promise<InvoiceWriteOutcome> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ status: platformInvoices.status, locationId: platformInvoices.locationId })
      .from(platformInvoices)
      .where(eq(platformInvoices.id, invoiceId))
      .limit(1)
      .for('update');

    const invoice = rows[0];
    if (invoice === undefined) {
      return { ok: false, code: 'not_found', message: 'Invoice not found.' } as const;
    }
    if (invoice.status !== 'draft') {
      return {
        ok: false,
        code: 'not_draft',
        message: 'Discounts can only be changed while the invoice is a draft.',
      } as const;
    }

    const taken = await tx
      .select({ position: platformInvoiceDiscounts.position })
      .from(platformInvoiceDiscounts)
      .where(eq(platformInvoiceDiscounts.invoiceId, invoiceId));

    const used = new Set(taken.map((row) => row.position));
    const position = [1, 2, 3].find((slot) => !used.has(slot));
    if (position === undefined || taken.length >= MAX_DISCOUNTS_PER_INVOICE) {
      return {
        ok: false,
        code: 'too_many',
        message: `An invoice can carry at most ${String(MAX_DISCOUNTS_PER_INVOICE)} discounts.`,
      } as const;
    }

    await tx.insert(platformInvoiceDiscounts).values({
      invoiceId,
      locationId: invoice.locationId,
      kind: input.kind,
      percentBasisPoints: input.kind === 'percent' ? input.value : null,
      fixedAmount: input.kind === 'fixed' ? paiseToNumeric(input.value) : null,
      amount: '0.00',
      description: input.description.trim(),
      position,
      createdBy: actorEmail,
    });

    await repriceDiscounts(tx, invoiceId);
    return { ok: true } as const;
  });
}

export async function removeInvoiceDiscount(
  invoiceId: string,
  discountId: string,
): Promise<InvoiceWriteOutcome> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ status: platformInvoices.status })
      .from(platformInvoices)
      .where(eq(platformInvoices.id, invoiceId))
      .limit(1)
      .for('update');

    const invoice = rows[0];
    if (invoice === undefined) {
      return { ok: false, code: 'not_found', message: 'Invoice not found.' } as const;
    }
    if (invoice.status !== 'draft') {
      return {
        ok: false,
        code: 'not_draft',
        message: 'Discounts can only be changed while the invoice is a draft.',
      } as const;
    }

    const removed = await tx
      .delete(platformInvoiceDiscounts)
      .where(
        and(
          eq(platformInvoiceDiscounts.id, discountId),
          eq(platformInvoiceDiscounts.invoiceId, invoiceId),
        ),
      )
      .returning({ id: platformInvoiceDiscounts.id });

    if (removed.length === 0) {
      return { ok: false, code: 'not_found', message: 'That discount is not on this invoice.' } as const;
    }

    await repriceDiscounts(tx, invoiceId);
    return { ok: true } as const;
  });
}

/* ═══════════════════════════════════════════════════════════ finalize */

/**
 * Draft → finalized, claimed. A zero-value invoice has nothing to pay and is
 * settled on the spot, so it can never be the reason a school is blocked.
 */
export async function finalizeInvoice(
  invoiceId: string,
  actorEmail: string,
): Promise<InvoiceWriteOutcome> {
  const rows = await db
    .select({ total: platformInvoices.total })
    .from(platformInvoices)
    .where(eq(platformInvoices.id, invoiceId))
    .limit(1);

  const invoice = rows[0];
  if (invoice === undefined) return { ok: false, code: 'not_found', message: 'Invoice not found.' };

  const now = new Date();
  const settledNow = isInvoiceCleared(0, toPaise(invoice.total));

  const claimed = await db
    .update(platformInvoices)
    .set({
      status: settledNow ? 'paid' : 'finalized',
      finalizedAt: now,
      finalizedBy: actorEmail,
      clearedAt: settledNow ? now : null,
      updatedAt: now,
    })
    .where(and(eq(platformInvoices.id, invoiceId), eq(platformInvoices.status, 'draft')))
    .returning({ id: platformInvoices.id });

  if (claimed.length === 0) {
    return { ok: false, code: 'not_draft', message: 'This invoice has already been finalized.' };
  }

  return { ok: true };
}

/* ═══════════════════════════════════════════════════════════ receipts */

export type ReceiptOutcome =
  | { ok: true; unblocked: boolean }
  | Extract<InvoiceWriteOutcome, { ok: false }>;

/**
 * Money in (§5, E6).
 *
 * In one transaction: lock the invoice, refuse a receipt against a draft or a
 * carried-forward invoice (E7 — its balance now lives on a later one), refuse
 * more than the balance, insert the receipt, and write the new received total —
 * with the status moved to `paid` the moment it counts as cleared.
 *
 * Then, outside it: if the school is blocked and nothing *else* it owes is past
 * its grace uncleared, unblock it and tell the school administrator. The
 * unblock is its own claim (`WHERE access_blocked_at IS NOT NULL`), so a
 * receipt recorded while the sweep is mid-tick cannot unblock twice.
 */
export async function recordInvoiceReceipt(
  invoiceId: string,
  input: { amountMinor: number; transactionId: string; description: string | null },
  actorEmail: string,
): Promise<ReceiptOutcome> {
  const outcome = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        status: platformInvoices.status,
        locationId: platformInvoices.locationId,
        total: platformInvoices.total,
        receivedTotal: platformInvoices.receivedTotal,
        clearedAt: platformInvoices.clearedAt,
      })
      .from(platformInvoices)
      .where(eq(platformInvoices.id, invoiceId))
      .limit(1)
      .for('update');

    const invoice = rows[0];
    if (invoice === undefined) {
      return { ok: false, code: 'not_found', message: 'Invoice not found.' } as const;
    }
    if (invoice.status !== 'finalized' && invoice.status !== 'paid') {
      return {
        ok: false,
        code: 'not_payable',
        message:
          invoice.status === 'draft'
            ? 'Finalize the invoice before recording money against it.'
            : 'This invoice’s balance was carried to a later invoice. Record the receipt there.',
      } as const;
    }

    const totalMinor = toPaise(invoice.total);
    const receivedMinor = toPaise(invoice.receivedTotal);
    const balance = totalMinor - receivedMinor;

    if (input.amountMinor > balance) {
      return {
        ok: false,
        code: 'over_balance',
        message: 'That is more than the balance on this invoice.',
      } as const;
    }

    await tx.insert(platformInvoiceReceipts).values({
      invoiceId,
      locationId: invoice.locationId,
      amount: paiseToNumeric(input.amountMinor),
      transactionId: input.transactionId.trim(),
      description: input.description,
      recordedBy: actorEmail,
    });

    const nextReceived = receivedMinor + input.amountMinor;
    const cleared = isInvoiceCleared(nextReceived, totalMinor);
    const now = new Date();

    await tx
      .update(platformInvoices)
      .set({
        receivedTotal: paiseToNumeric(nextReceived),
        status: cleared ? 'paid' : invoice.status,
        clearedAt: cleared ? (invoice.clearedAt ?? now) : invoice.clearedAt,
        updatedAt: now,
      })
      .where(eq(platformInvoices.id, invoiceId));

    return { ok: true, cleared, locationId: invoice.locationId } as const;
  });

  if (!outcome.ok) return outcome;

  let unblocked = false;
  if (outcome.cleared) {
    const today = karachiToday(new Date());
    const settings = await getBillingSettings(outcome.locationId);
    const stillOwing = await overdueUnclearedInvoices(outcome.locationId, today, settings.graceDays);
    if (stillOwing.length === 0) {
      unblocked = await unblockSchool(outcome.locationId, 'payment', actorEmail, invoiceId);
    }
  }

  return { ok: true, unblocked };
}

/* ═══════════════════════════════════════════════════════════ recipients */

/** The school's first active administrator with a real address, or null. */
export async function schoolAdminEmail(locationId: string): Promise<string | null> {
  const rows = await db
    .select({ email: schoolUsers.email })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.role, 'school_admin'),
        eq(schoolUsers.isActive, true),
        isNotNull(schoolUsers.email),
      ),
    )
    .orderBy(asc(schoolUsers.createdAt))
    .limit(5);

  const found = rows.find(
    (row) => row.email !== null && row.email.trim() !== '' && !isStudentCredentialAddress(row.email),
  );
  return found?.email ?? null;
}

/** E11: the remembered address if there is one, else the administrator's. */
export async function defaultInvoiceRecipient(locationId: string): Promise<string | null> {
  const settings = await getBillingSettings(locationId);
  if (settings.invoiceEmail !== null && settings.invoiceEmail.trim() !== '') {
    return settings.invoiceEmail;
  }
  return schoolAdminEmail(locationId);
}

/**
 * Logs a send, and remembers the address when it was not already the default
 * (E11). The remembering upserts the settings row, so a school with no row yet
 * gets one — sandbox, as every row starts.
 */
export async function recordInvoiceEmail(input: {
  invoiceId: string;
  locationId: string;
  to: string;
  status: 'sent' | 'failed';
  error: string | null;
  sentBy: string;
}): Promise<void> {
  await db.insert(platformInvoiceEmails).values({
    invoiceId: input.invoiceId,
    locationId: input.locationId,
    toAddress: input.to,
    status: input.status,
    error: input.error,
    sentBy: input.sentBy,
  });

  if (input.status !== 'sent') return;

  await db
    .insert(schoolBillingSettings)
    .values({ locationId: input.locationId, invoiceEmail: input.to })
    .onConflictDoUpdate({
      target: schoolBillingSettings.locationId,
      set: { invoiceEmail: input.to, updatedAt: new Date() },
    });
}

/* ═══════════════════════════════════════════════════════════ bank accounts */

export interface PlatformBankAccount {
  id: string;
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  iban: string;
  branchName: string | null;
  branchCode: string | null;
  city: string | null;
  position: number;
}

export async function listPlatformBankAccounts(): Promise<PlatformBankAccount[]> {
  const rows = await db
    .select()
    .from(platformBankAccounts)
    .orderBy(asc(platformBankAccounts.position));
  return rows.map((row) => ({
    id: row.id,
    bankName: row.bankName,
    accountTitle: row.accountTitle,
    accountNumber: row.accountNumber,
    iban: row.iban,
    branchName: row.branchName,
    branchCode: row.branchCode,
    city: row.city,
    position: row.position,
  }));
}

export interface BankAccountInput {
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  /** Already normalised: no spaces, upper case, checksum passed. */
  iban: string;
  branchName: string | null;
  branchCode: string | null;
  city: string | null;
}

/**
 * Adds an account in the first free slot, or returns null when all three are
 * taken. The slot is a unique index, so two operators adding the third account
 * at once get one success and one 23505 — never four accounts.
 */
export async function createPlatformBankAccount(
  input: BankAccountInput,
): Promise<PlatformBankAccount | null> {
  const taken = await db.select({ position: platformBankAccounts.position }).from(platformBankAccounts);
  const used = new Set(taken.map((row) => row.position));
  const position = [1, 2, 3].find((slot) => !used.has(slot));
  if (position === undefined) return null;

  const inserted = await db
    .insert(platformBankAccounts)
    .values({ ...input, position })
    .onConflictDoNothing()
    .returning();

  const row = inserted[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        bankName: row.bankName,
        accountTitle: row.accountTitle,
        accountNumber: row.accountNumber,
        iban: row.iban,
        branchName: row.branchName,
        branchCode: row.branchCode,
        city: row.city,
        position: row.position,
      };
}

export async function updatePlatformBankAccount(
  id: string,
  input: BankAccountInput,
): Promise<boolean> {
  const updated = await db
    .update(platformBankAccounts)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(platformBankAccounts.id, id))
    .returning({ id: platformBankAccounts.id });
  return updated.length > 0;
}

export async function deletePlatformBankAccount(id: string): Promise<boolean> {
  const removed = await db
    .delete(platformBankAccounts)
    .where(eq(platformBankAccounts.id, id))
    .returning({ id: platformBankAccounts.id });
  return removed.length > 0;
}

/* ═══════════════════════════════════════════════════════════ access */

/**
 * The finalized invoices, uncleared, whose grace has run out (E5).
 *
 * Only `finalized` counts. A draft has never been sent, so nobody is blocked
 * over it; a carried-forward invoice's balance now lives on a later invoice,
 * which is the one that will be chased. `paid` is cleared by definition.
 */
export async function overdueUnclearedInvoices(
  locationId: string,
  today: string,
  graceDays: number,
): Promise<{ id: string; invoiceNumber: string }[]> {
  // The last due date whose grace has fully run out by `today`.
  const lastBlockingDueDate = addDays(today, -(Math.max(0, graceDays) + 1));

  return db
    .select({ id: platformInvoices.id, invoiceNumber: platformInvoices.invoiceNumber })
    .from(platformInvoices)
    .where(
      and(
        eq(platformInvoices.locationId, locationId),
        eq(platformInvoices.status, 'finalized'),
        lte(platformInvoices.dueDate, lastBlockingDueDate),
      ),
    );
}

/** All active school administrators with a deliverable address. */
async function schoolAdminAddresses(locationId: string): Promise<string[]> {
  const rows = await db
    .select({ email: schoolUsers.email })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.role, 'school_admin'),
        eq(schoolUsers.isActive, true),
        isNotNull(schoolUsers.email),
      ),
    );

  const addresses = rows
    .map((row) => row.email?.trim() ?? '')
    .filter((email) => email !== '' && !isStudentCredentialAddress(email));
  return [...new Set(addresses.map((email) => email.toLowerCase()))];
}

function portalLink(slug: string): string {
  const base = serverEnv('PLATFORM_BASE_DOMAIN', serverEnv('NEXT_PUBLIC_APP_DOMAIN', '')).trim();
  return base === '' ? '' : `https://${slug}.${base}`;
}

async function emailAccessChange(
  locationId: string,
  action: 'blocked' | 'unblocked',
): Promise<void> {
  const schoolRows = await db
    .select({ name: schools.name, slug: schools.slug })
    .from(schools)
    .where(eq(schools.locationId, locationId))
    .limit(1);
  const school = schoolRows[0];
  if (school === undefined) return;

  const recipients = await schoolAdminAddresses(locationId);
  if (recipients.length === 0) {
    console.warn(`[billing] ${school.name} was ${action}; no administrator address to tell`);
    return;
  }

  const link = portalLink(school.slug);
  const subject =
    action === 'blocked'
      ? `${school.name}: SchoolHub access suspended`
      : `${school.name}: SchoolHub access restored`;

  const text =
    action === 'blocked'
      ? `Access to ${school.name} on SchoolHub has been suspended because a SchoolHub invoice is unpaid.\n\n` +
        'Staff, students and parents will see a suspended notice until it is settled. As the school ' +
        'administrator you can still sign in to see the invoice, the amount due and the bank details.\n\n' +
        `${link === '' ? '' : `${link}\n\n`}` +
        'If you have already paid, reply to this email with the transaction reference.\n'
      : `Access to ${school.name} on SchoolHub has been restored. Thank you.\n\n` +
        `${link === '' ? '' : `${link}\n`}`;

  for (const to of recipients) {
    try {
      await enqueueEmail({ locationId, to, subject, text });
    } catch (error) {
      console.error(`[billing] could not queue the ${action} email for ${school.name}:`, error);
    }
  }
}

/**
 * Blocks a school — claimed. Returns false when it was already blocked, in
 * which case nothing is recorded and nobody is emailed a second time.
 */
export async function blockSchool(
  locationId: string,
  reason: 'manual' | 'overdue',
  actor: string,
  invoiceId: string | null = null,
): Promise<boolean> {
  const now = new Date();
  const claimed = await db
    .update(schools)
    .set({ accessBlockedAt: now, updatedAt: now })
    .where(and(eq(schools.locationId, locationId), isNull(schools.accessBlockedAt)))
    .returning({ locationId: schools.locationId });

  if (claimed.length === 0) return false;

  await db.insert(schoolAccessEvents).values({
    locationId,
    action: 'blocked',
    reason,
    actor,
    invoiceId,
  });
  await emailAccessChange(locationId, 'blocked');
  return true;
}

export async function unblockSchool(
  locationId: string,
  reason: 'manual' | 'payment',
  actor: string,
  invoiceId: string | null = null,
): Promise<boolean> {
  const now = new Date();
  const claimed = await db
    .update(schools)
    .set({ accessBlockedAt: null, updatedAt: now })
    .where(and(eq(schools.locationId, locationId), isNotNull(schools.accessBlockedAt)))
    .returning({ locationId: schools.locationId });

  if (claimed.length === 0) return false;

  await db.insert(schoolAccessEvents).values({
    locationId,
    action: 'unblocked',
    reason,
    actor,
    invoiceId,
  });
  await emailAccessChange(locationId, 'unblocked');
  return true;
}

/* ═══════════════════════════════════════════════════════════ the sweeps */

/**
 * Raises last month's draft for every Live school that has none (§5).
 *
 * Runs on every tick rather than only on the 1st: "on the 1st and on every
 * later tick that finds one missing", so a process that was down over
 * midnight on the 1st still bills the month. The read is one statement over
 * Live schools; the work, when there is any, is claimed per school by the
 * unique index.
 */
export async function sweepInvoiceGeneration(now: Date = new Date()): Promise<number> {
  const period = billedMonthFor(now);

  const live = await db
    .select({ locationId: schoolBillingSettings.locationId })
    .from(schoolBillingSettings)
    .innerJoin(schools, eq(schools.locationId, schoolBillingSettings.locationId))
    .where(
      and(
        eq(schoolBillingSettings.environment, 'live'),
        isNotNull(schoolBillingSettings.liveSince),
        lte(schoolBillingSettings.liveSince, period.end),
        eq(schools.isActive, true),
      ),
    );

  if (live.length === 0) return 0;

  const billed = await db
    .select({ locationId: platformInvoices.locationId })
    .from(platformInvoices)
    .where(
      and(
        eq(platformInvoices.periodStart, period.start),
        inArray(
          platformInvoices.locationId,
          live.map((row) => row.locationId),
        ),
      ),
    );

  const done = new Set(billed.map((row) => row.locationId));
  let created = 0;

  for (const row of live) {
    if (done.has(row.locationId)) continue;
    try {
      const outcome = await generateInvoiceForSchool(row.locationId, period.start, 'sweep');
      if (outcome.status === 'created') created += 1;
      else if (outcome.status === 'missing_rate') {
        console.warn(`[billing] ${row.locationId}: no USD→PKR rate, invoice not raised`);
      }
    } catch (error) {
      console.error(`[billing] invoice generation failed for ${row.locationId}:`, error);
    }
  }

  return created;
}

/** Blocks every Live school holding a finalized invoice past grace (§6). */
export async function sweepOverdueBlocking(now: Date = new Date()): Promise<number> {
  const today = karachiToday(now);

  const candidates = await db
    .select({
      locationId: platformInvoices.locationId,
      invoiceId: platformInvoices.id,
      dueDate: platformInvoices.dueDate,
      graceDays: schoolBillingSettings.graceDays,
    })
    .from(platformInvoices)
    .innerJoin(schoolBillingSettings, eq(schoolBillingSettings.locationId, platformInvoices.locationId))
    .innerJoin(schools, eq(schools.locationId, platformInvoices.locationId))
    .where(
      and(
        eq(platformInvoices.status, 'finalized'),
        lt(platformInvoices.dueDate, today),
        eq(schoolBillingSettings.environment, 'live'),
        isNull(schools.accessBlockedAt),
        eq(schools.isActive, true),
      ),
    );

  let blocked = 0;
  const seen = new Set<string>();

  for (const row of candidates) {
    if (seen.has(row.locationId)) continue;
    const lastBlockingDueDate = addDays(today, -(Math.max(0, row.graceDays) + 1));
    if (compareDates(row.dueDate, lastBlockingDueDate) > 0) continue;

    seen.add(row.locationId);
    try {
      if (await blockSchool(row.locationId, 'overdue', 'sweep', row.invoiceId)) blocked += 1;
    } catch (error) {
      console.error(`[billing] could not block ${row.locationId}:`, error);
    }
  }

  return blocked;
}

/**
 * Trial reminders, five days and one day before the trial ends (§4).
 *
 * Each is claimed with `INSERT … ON CONFLICT DO NOTHING RETURNING` on
 * (school, kind, trial end) before anything is sent, so seven processes — or a
 * lease that changed hands mid-tick — send it once. A window rather than an
 * exact day, so a tick missed on the day still sends it the day after; the
 * message states the real number of days left.
 */
export async function sweepTrialReminders(
  now: Date,
  send: (reminder: TrialReminder) => Promise<void>,
): Promise<number> {
  const today = karachiToday(now);

  const live = await db
    .select({
      locationId: schoolBillingSettings.locationId,
      liveSince: schoolBillingSettings.liveSince,
      trialDays: schoolBillingSettings.trialDays,
      schoolId: schools.id,
      schoolName: schools.name,
    })
    .from(schoolBillingSettings)
    .innerJoin(schools, eq(schools.locationId, schoolBillingSettings.locationId))
    .where(
      and(
        eq(schoolBillingSettings.environment, 'live'),
        isNotNull(schoolBillingSettings.liveSince),
        ne(schoolBillingSettings.trialDays, 0),
        eq(schools.isActive, true),
      ),
    );

  let sent = 0;

  for (const school of live) {
    const end = trialEndsOn(school.liveSince, school.trialDays);
    if (end === null) continue;

    const daysLeft = daysInclusive(today, end) - 1;
    const kind: TrialReminder['kind'] | null =
      daysLeft >= 0 && daysLeft <= 1 ? 'trial_1d' : daysLeft >= 2 && daysLeft <= 5 ? 'trial_5d' : null;
    if (kind === null) continue;

    const claimed = await db
      .insert(billingReminders)
      .values({ locationId: school.locationId, kind, trialEndsOn: end })
      .onConflictDoNothing()
      .returning({ id: billingReminders.id });

    if (claimed.length === 0) continue;

    try {
      await send({
        kind,
        locationId: school.locationId,
        schoolId: school.schoolId,
        schoolName: school.schoolName,
        trialEndsOn: end,
        daysLeft,
      });
      sent += 1;
    } catch (error) {
      // Hand the claim back, so the next tick tries again rather than the
      // school believing a reminder went out that nobody received.
      await db
        .delete(billingReminders)
        .where(eq(billingReminders.id, claimed[0]?.id ?? ''));
      console.error(`[billing] trial reminder for ${school.schoolName} failed:`, error);
    }
  }

  return sent;
}

export interface TrialReminder {
  kind: 'trial_5d' | 'trial_1d';
  locationId: string;
  schoolId: string;
  schoolName: string;
  trialEndsOn: string;
  daysLeft: number;
}


/* ═══════════════════════════════════════════════════════════ the suspended page */

export interface SuspendedView {
  invoices: {
    id: string;
    invoiceNumber: string;
    periodLabel: string;
    currency: BillingCurrency;
    amountDueMinor: number;
    dueDate: string;
  }[];
  bankAccounts: PlatformBankAccount[];
}

/**
 * What a blocked school's administrator is shown (§6): every finalized
 * invoice still owing, the amount due on each, its due date, and where to pay.
 * Scoped to the caller's own tenant by the only `locationId` it is given.
 */
export async function getSuspendedView(locationId: string): Promise<SuspendedView> {
  const [invoices, bankAccounts] = await Promise.all([
    db
      .select({
        id: platformInvoices.id,
        invoiceNumber: platformInvoices.invoiceNumber,
        periodStart: platformInvoices.periodStart,
        invoiceCurrency: platformInvoices.invoiceCurrency,
        total: platformInvoices.total,
        receivedTotal: platformInvoices.receivedTotal,
        dueDate: platformInvoices.dueDate,
      })
      .from(platformInvoices)
      .where(
        and(
          eq(platformInvoices.locationId, locationId),
          inArray(platformInvoices.status, ['finalized', 'paid']),
        ),
      )
      .orderBy(asc(platformInvoices.periodStart)),
    listPlatformBankAccounts(),
  ]);

  return {
    invoices: invoices
      .map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        periodLabel: monthLabel(invoice.periodStart),
        currency: (isBillingCurrency(invoice.invoiceCurrency) ? invoice.invoiceCurrency : 'USD') as BillingCurrency,
        amountDueMinor: toPaise(invoice.total) - toPaise(invoice.receivedTotal),
        dueDate: shortDate(invoice.dueDate),
      }))
      .filter((invoice) => invoice.amountDueMinor > 0),
    bankAccounts,
  };
}

/** Is this invoice this tenant's? For the school-side PDF route. */
export async function invoiceBelongsTo(invoiceId: string, locationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: platformInvoices.id })
    .from(platformInvoices)
    .where(
      and(
        eq(platformInvoices.id, invoiceId),
        eq(platformInvoices.locationId, locationId),
        ne(platformInvoices.status, 'draft'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

