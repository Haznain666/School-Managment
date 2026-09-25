/**
 * Sprint 35 — the billing rules, asserted; then every new statement, executed.
 *
 *     npm run check-sprint35
 *
 * ── Part one needs no database ───────────────────────────────────────────
 * The rules the spec decided with the product owner, each one asserted rather
 * than admired, because every one of them is arithmetic that a screen can get
 * "nearly" right for months:
 *
 *   · **E3 proration** — the brief's own example (trial ends 20 Oct → bills
 *     21–31 Oct) is **eleven** days, not ten, and both Februaries are right.
 *   · **E5 due date and grace** — due on the 10th, blocked from the 13th.
 *   · **E6 clearing** — at the threshold and one minor unit under it, and the
 *     threshold appears in **no** file a browser downloads.
 *   · **E10 discounts** — percentages of the pre-discount subtotal, capped,
 *     never negative.
 *   · **E2 count** — the grouped statement excludes parents and inactive rows.
 *   · the §2 estimate reproduces **USD 162.00**.
 *   · IBANs, currency conversion both ways, the permission grid, and the
 *     migration's RLS / REVOKE / trigger / CHECK.
 *
 * ── Part two executes against the real schema ────────────────────────────
 * Printing `toSQL()` proves the names; only a server proves a statement
 * (CLAUDE.md). The script reads whether `0052` is applied rather than being
 * told. Before it, a statement touching the new tables must fail with exactly
 * `42P01`, and one touching `schools.access_blocked_at` with exactly `42703` —
 * **any other error is a real defect wearing a predicted failure's clothes**.
 *
 * ── What is deliberately not executed ────────────────────────────────────
 * The writes: generation, finalize, receipts, discounts, block/unblock, the
 * hand-off redemption and the reminder claim. A check script that issues an
 * `UPDATE` against a live database is one edit away from issuing one that
 * matches (`check-sprint24`). Their *reads* are exported and executed below.
 * `getSchoolBillingOverview` and `generateInvoiceForSchool` short-circuit on a
 * school that does not exist, so they are reported as **not exercised**.
 *
 * Two traps, both paid for before: the SQLSTATE is on the error's `cause`,
 * and a read that returns early is not a read that passed.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';

function loadDatabaseUrl(): boolean {
  if (process.env.DATABASE_URL !== undefined) return true;

  for (const candidate of [
    'D:/School-Management-System/.env.local',
    '../../../.env.local',
    '.env.local',
  ]) {
    try {
      const match = /^DATABASE_URL=(.*)$/m.exec(readFileSync(candidate, 'utf8'));
      if (match?.[1] !== undefined) {
        process.env.DATABASE_URL = match[1].trim().replace(/^['"]|['"]$/g, '');
        console.log(`  using DATABASE_URL from ${candidate}`);
        return true;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return false;
}

const NOBODY = '00000000-0000-0000-0000-000000000000';
const TENANT = 'no-such-tenant-sprint35';

const UNDEFINED_TABLE = '42P01';
const UNDEFINED_COLUMN = '42703';

let passes = 0;
let failures = 0;

function pass(label: string, detail = ''): void {
  passes += 1;
  console.log(`  ok    ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

function fail(label: string, detail: string): void {
  failures += 1;
  console.error(`  FAIL  ${label}\n        ${detail}`);
}

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) pass(label);
  else fail(label, detail === '' ? 'assertion false' : detail);
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (same) pass(label, JSON.stringify(actual));
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function sqlState(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function reason(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && !message.startsWith('Failed query')) {
      return (message.split('\n')[0] ?? message).slice(0, 140);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return String(error).slice(0, 140);
}

async function mustRun(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    pass(label, Array.isArray(value) ? `${String(value.length)} row(s)` : 'executed');
  } catch (error) {
    fail(label, `${sqlState(error) ?? '?'} ${reason(error)}`);
  }
}

function afterMigration(applied: boolean, expected: string) {
  return async (label: string, run: () => Promise<unknown>): Promise<void> => {
    if (applied) {
      await mustRun(label, run);
      return;
    }
    try {
      await run();
      fail(label, 'it executed although 0052 is not applied — the prediction is wrong');
    } catch (error) {
      const state = sqlState(error);
      if (state === expected) pass(label, `predicted ${expected} — waiting on 0052`);
      else fail(label, `expected ${expected} before 0052, got ${state ?? '?'} ${reason(error)}`);
    }
  };
}

const source = (path: string): string => readFileSync(path, 'utf8').split('\r\n').join('\n');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

async function main(): Promise<void> {
  /* ══════════════════════════════════════════════ part one: the rules */

  const billing = await import('../lib/platform-billing');
  const { isInvoiceCleared } = await import('../lib/platform-invoice-clearing');
  const money = await import('../lib/money');
  const perms = await import('../lib/super-admin-permissions');
  const modules = await import('../lib/platform-modules');

  console.log('\n§9 — who may manage whom:');
  {
    const full = { isOwner: false, permissions: perms.fullSuperAdminPermissions() };
    const none = { isOwner: false, permissions: perms.emptySuperAdminPermissions() };
    const owner = { isOwner: true, permissions: perms.emptySuperAdminPermissions() };
    const adminsOnly = perms.emptySuperAdminPermissions();
    adminsOnly.super_admins = { c: true, r: true, u: true, d: true };
    const editor = { isOwner: false, permissions: adminsOnly };
    assert('the owner may manage anyone', perms.canManageSuperAdmin(owner, full));
    assert('nobody else may manage the owner', !perms.canManageSuperAdmin(full, owner));
    assert('an admin-editor may manage an admin with less', perms.canManageSuperAdmin(editor, none));
    assert(
      'an admin-editor may NOT manage (reset the password of) a broader admin',
      !perms.canManageSuperAdmin(editor, full),
    );
    assert('a full admin may manage an admin-editor', perms.canManageSuperAdmin(full, editor));
  }

  console.log('\nE4 — the trial’s last free day:');
  equal('20 days from 1 Oct ends on 20 Oct', billing.trialEndsOn('2026-10-01', 20), '2026-10-20');
  equal('no trial is null, not the day before', billing.trialEndsOn('2026-10-01', 0), null);
  equal('a Sandbox school has no trial end', billing.trialEndsOn(null, 30), null);

  console.log('\nE3 — proration by day:');
  const october = billing.billablePeriod('2026-10-01', '2026-10-01', '2026-10-20');
  equal('trial ending 20 Oct bills 21–31 Oct', october?.from, '2026-10-21');
  equal('which is ELEVEN days of 31 (the brief said ten; both ends count)', [october?.billableDays, october?.daysInMonth], [11, 31]);
  equal('USD 100 a month for 11 of 31 days is USD 35.48, half-up', billing.prorate(10_000, 11, 31), 3548);
  equal('a whole month bills exactly the monthly rate', billing.prorate(10_000, 31, 31), 10_000);
  equal('February 2026 has 28 days', billing.daysInMonth('2026-02-01'), 28);
  equal('February 2028 has 29 days', billing.daysInMonth('2028-02-01'), 29);
  const feb = billing.billablePeriod('2028-02-01', '2028-02-15', null);
  equal('live 15 Feb 2028, no trial: 15 of 29 days', [feb?.billableDays, feb?.daysInMonth], [15, 29]);
  equal('USD 29 × 15/29 is exactly USD 15.00', billing.prorate(2_900, 15, 29), 1_500);
  const feb26 = billing.billablePeriod('2026-02-01', '2026-01-01', '2026-02-14');
  equal('trial ending 14 Feb 2026 bills 14 of 28 days', [feb26?.from, feb26?.billableDays], ['2026-02-15', 14]);
  equal('a school live after the month has nothing to bill', billing.billablePeriod('2026-10-01', '2026-11-03', null), null);
  equal('a trial covering the whole month bills nothing', billing.billablePeriod('2026-10-01', '2026-09-20', '2026-10-31'), null);
  equal('half-up at exactly .5', billing.prorate(1, 1, 2), 1);

  console.log('\nE5 — due date, grace and the block day:');
  equal('October is due on 10 November', billing.dueDateForPeriod('2026-10-01'), '2026-11-10');
  equal('December is due on 10 January of the next year', billing.dueDateForPeriod('2026-12-01'), '2027-01-10');
  equal('two days of grace block from the 13th', billing.blockingStartsOn('2026-11-10', 2), '2026-11-13');
  assert('not blocked on the 12th', !billing.isPastGrace('2026-11-10', 2, '2026-11-12'));
  assert('blocked on the 13th', billing.isPastGrace('2026-11-10', 2, '2026-11-13'));
  equal('the month billed on 1 Nov is October (Q1, arrears)', billing.previousMonth('2026-11-01'), {
    start: '2026-10-01',
    end: '2026-10-31',
  });
  equal('the month billed in January is last December', billing.previousMonth('2027-01-01').start, '2026-12-01');
  equal('00:30 in Karachi on 1 Nov is already 1 Nov', billing.karachiToday(new Date('2026-10-31T19:30:00Z')), '2026-11-01');
  equal('an invoice is overdue the day after it is due', billing.invoiceDisplayStatus('finalized', '2026-11-10', '2026-11-11'), 'overdue');
  equal('and due on the day', billing.invoiceDisplayStatus('finalized', '2026-11-10', '2026-11-10'), 'due');

  console.log('\nE6 — clearing, and where the rule may live:');
  assert('79.99% of a USD 100 invoice is not cleared', !isInvoiceCleared(7_999, 10_000));
  assert('80% exactly is cleared', isInvoiceCleared(8_000, 10_000));
  assert('a zero invoice is cleared', isInvoiceCleared(0, 0));
  assert('an odd total rounds in the school’s favour at the boundary', isInvoiceCleared(8_001, 10_001) && !isInvoiceCleared(8_000, 10_001));
  assert(
    'the clearing module is server-only, so no client bundle can carry it',
    source('lib/platform-invoice-clearing.ts').startsWith("import 'server-only';"),
  );

  /*
   * Every surface Sprint 35 put in front of a person: the super admin's billing
   * screens, the school administrator's suspended page, and the builders of
   * the PDF and the emails. The fee module's own "partially paid" voucher
   * state is a different product and is deliberately not scanned.
   */
  const billingSurfaces = [
    'components/super-admin/BillingSettingsPanel.tsx',
    'components/super-admin/InvoiceDetailPanel.tsx',
    'components/super-admin/InvoiceListing.tsx',
    'components/super-admin/PlatformBankAccountsManager.tsx',
    'components/super-admin/invoice-badge.ts',
    ...walk('app/(super-admin)/super-admin/billing'),
    ...walk('app/(super-admin)/super-admin/schools/[schoolId]/billing'),
    ...walk('app/(public)/suspended'),
    ...walk('app/api/super-admin/billing'),
    ...walk('app/api/school/billing'),
    'lib/platform-billing.ts',
    'lib/platform-invoice-pdf.ts',
    'lib/platform-invoice-documents.ts',
    'lib/platform-billing-sweeps.ts',
  ];
  const withoutComments = (path: string): string =>
    source(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const importers = [...walk('components'), ...walk('app')].filter((path) =>
    /from ['"]@\/lib\/platform-invoice-clearing['"]/.test(source(path)),
  );
  assert('nothing under app/ or components/ imports the clearing rule', importers.length === 0, importers.join(', '));

  const leaks = billingSurfaces.filter((path) => /\b80\s?%|\b8[_,]?000\b|\b0\.8\b/.test(withoutComments(path)));
  assert('no billing screen, PDF or email builder states the threshold', leaks.length === 0, leaks.join(', '));

  const partial = billingSurfaces.filter((path) => /\b[Pp]artial(ly)?\b|\b[Mm]inimum\b/.test(withoutComments(path)));
  assert('and none of them says "partial" or "minimum"', partial.length === 0, partial.join(', '));
  equal(
    'the five chips are the five the spec names',
    Object.values(billing.INVOICE_DISPLAY_LABELS),
    ['Draft', 'Finalized (Due)', 'Overdue', 'Paid', 'Carried forward'],
  );

  console.log('\nE10 — discounts:');
  equal(
    'two 10% discounts are 20% of the subtotal, not 19%',
    billing.applyDiscounts(10_000, [
      { kind: 'percent', value: 1_000 },
      { kind: 'percent', value: 1_000 },
    ]),
    { amounts: [1_000, 1_000], totalDiscount: 2_000, total: 8_000 },
  );
  equal(
    'a fixed discount larger than what is left is capped at what is left',
    billing.applyDiscounts(10_000, [
      { kind: 'percent', value: 5_000 },
      { kind: 'fixed', value: 9_000 },
    ]),
    { amounts: [5_000, 5_000], totalDiscount: 10_000, total: 0 },
  );
  equal(
    'three discounts can never take the total below zero',
    billing.applyDiscounts(1_000, [
      { kind: 'fixed', value: 800 },
      { kind: 'fixed', value: 800 },
      { kind: 'percent', value: 10_000 },
    ]).total,
    0,
  );
  equal('12.5% of USD 162.00 is USD 20.25', billing.applyDiscounts(16_200, [{ kind: 'percent', value: 1_250 }]).amounts, [2_025]);
  assert('a discount needs a description', billing.discountProblem('fixed', 100, '  ') !== null);
  assert('a percentage above 100 is refused', billing.discountProblem('percent', 10_001, 'x') !== null);
  assert('a sensible one passes', billing.discountProblem('percent', 1_000, 'Launch offer') === null);
  equal('at most three per invoice', billing.MAX_DISCOUNTS_PER_INVOICE, 3);

  console.log('\n§2 — the estimate the Billing tab must reproduce:');
  const estimate = billing.monthlyEstimate(
    [
      { role: 'principal', label: 'Principal', count: 1, rateMinor: 100 },
      { role: 'vice_principal', label: 'Vice Principal', count: 1, rateMinor: 100 },
      { role: 'section_head', label: 'Section Head', count: 2, rateMinor: 100 },
      { role: 'teacher', label: 'Teacher', count: 8, rateMinor: 100 },
      { role: 'student', label: 'Student', count: 100, rateMinor: 100 },
    ],
    [{ key: 'chat', label: 'Chat', rateMinor: 5_000 }],
  );
  equal('1 + 1 + 2 + 8 + 100 users at USD 1 and Chat at USD 50', money.formatMoneyMinor(estimate.totalMinor, 'USD'), 'USD 162.00');
  equal('PKR is formatted the way every rupee is', money.formatMoneyMinor(1_250_050, 'PKR'), 'PKR 12,500.50');

  console.log('\nCurrency (E1):');
  const rate = billing.rateToUnits('280.5');
  equal('280.5 PKR per USD is 2,805,000 ten-thousandths', rate, 2_805_000);
  equal('USD 1.00 is PKR 280.50', billing.convertMinor(100, 'USD', 'PKR', rate), 28_050);
  equal('PKR 280.50 is USD 1.00', billing.convertMinor(28_050, 'PKR', 'USD', rate), 100);
  equal('same currency is untouched', billing.convertMinor(123, 'USD', 'USD', null), 123);
  let threw = false;
  try {
    billing.convertMinor(100, 'USD', 'PKR', null);
  } catch {
    threw = true;
  }
  assert('converting without a rate throws rather than inventing one', threw);
  equal('a rate of 0 is no rate', billing.rateToUnits('0'), null);

  console.log('\n§5 — bank accounts and numbering:');
  equal('a real Pakistani IBAN passes its checksum', billing.ibanProblem('PK36SCBL0000001123456702'), null);
  assert('one transposed digit fails it', billing.ibanProblem('PK36SCBL0000001123456720') !== null);
  assert('a UK IBAN is refused', billing.ibanProblem('GB82WEST12345698765432') !== null);
  equal('spaces are allowed on the way in', billing.ibanProblem('pk36 scbl 0000 0011 2345 6702'), null);
  equal('at most three accounts', billing.MAX_PLATFORM_BANK_ACCOUNTS, 3);
  equal('the invoice number is derived, not sequenced', billing.invoiceNumberFor('2026-10-01', 'beacon-house'), 'INV-202610-BEACONHOUSE');

  console.log('\nE9 — Phase 1 is included:');
  equal('the three always-on modules', modules.ALWAYS_ON_MODULE_KEYS, ['admissions', 'fee_management', 'academics']);
  const flags = modules.toModuleFlags([{ moduleKey: 'admissions', isEnabled: false }]);
  assert('a row saying off cannot switch Phase 1 off', flags.admissions && flags.fee_management && flags.academics);
  assert('and a paid module still follows its row', !flags.chat);
  for (const route of [
    'app/api/super-admin/schools/[schoolId]/modules/route.ts',
    'app/api/super-admin/schools/bulk-modules/route.ts',
  ]) {
    assert(`${route} refuses switching an included module off`, source(route).includes('isAlwaysOnModule('));
  }

  console.log('\n§9 — the permission grid:');
  const normalised = perms.normaliseSuperAdminPermissions({ billing: { u: true }, bogus: { c: true } });
  assert('edit implies view', normalised.billing.r && normalised.billing.u && !normalised.billing.c);
  assert('an unknown area grants nothing', !('bogus' in normalised));
  assert('the owner can do anything', perms.superAdminCan({ isOwner: true, permissions: perms.emptySuperAdminPermissions() }, 'super_admins', 'd'));
  assert('an admin with nothing can do nothing', !perms.superAdminCan({ isOwner: false, permissions: perms.emptySuperAdminPermissions() }, 'schools', 'r'));
  equal('six areas', perms.SUPER_ADMIN_AREAS, ['schools', 'modules', 'billing', 'feedback', 'catalogue', 'super_admins']);
  equal('the owner', perms.PLATFORM_OWNER_EMAIL, 'haznain666@gmail.com');

  const unguarded = walk('app/api/super-admin').filter((path) => {
    if (path.includes(`${join('auth', '')}`)) return false;
    return !source(path).includes('requireSuperAdmin');
  });
  assert('every /api/super-admin route outside auth re-reads the operator', unguarded.length === 0, unguarded.join(', '));

  console.log('\n0052 — the migration file:');
  const migration = source('db/migrations/0052_sprint35_billing.sql');
  const tables = [
    'super_admin_users',
    'school_billing_settings',
    'school_role_rates',
    'school_module_rates',
    'platform_invoices',
    'platform_invoice_lines',
    'platform_invoice_discounts',
    'platform_invoice_receipts',
    'platform_invoice_emails',
    'platform_bank_accounts',
    'billing_reminders',
    'school_access_events',
    'login_handoff_tokens',
  ];
  const noRls = tables.filter((table) => !migration.includes(`ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY`));
  assert('RLS is enabled on all thirteen new tables', noRls.length === 0, noRls.join(', '));
  const noRevoke = tables.filter((table) => !new RegExp(`"public"\\."${table}"[,\\s]`).test(migration.slice(migration.indexOf('REVOKE ALL ON TABLE'))));
  assert('and all thirteen are revoked from anon and authenticated', noRevoke.length === 0, noRevoke.join(', '));
  assert('the owner-protection trigger is installed', migration.includes('CREATE TRIGGER "super_admin_users_protect_owner"'));
  assert('one owner is a unique index', migration.includes('"super_admin_users_one_owner_idx"'));
  assert('the throttle CHECK admits central_login', /auth_attempts_scope_check[\s\S]*'central_login'/.test(migration));
  assert('every school is backfilled to sandbox', migration.includes('INSERT INTO "school_billing_settings" ("location_id")'));
  assert('Phase 1 is backfilled on', migration.includes("('admissions'), ('fee_management'), ('academics')"));
  assert('the journal knows 0052', source('db/migrations/meta/_journal.json').includes('"0052_sprint35_billing"'));

  const { BILLABLE_ROLES } = await import('../db/schema/platform-billing');
  assert('parents can never carry a rate', !(BILLABLE_ROLES as readonly string[]).includes('parent'));
  const roleCheck = /school_role_rates_role_check" CHECK \(role IN \(([^)]*)\)\)/.exec(migration)?.[1] ?? '';
  equal(
    'the rate CHECK is exactly the billable roles',
    roleCheck.split(',').map((part) => part.trim().replace(/'/g, '')),
    [...BILLABLE_ROLES],
  );

  /* ══════════════════════════════════ part two: against the real schema */

  if (!loadDatabaseUrl()) {
    console.log('\n  --    no DATABASE_URL: part two NOT exercised.');
    console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} passed, ${String(failures)} failed.`);
    process.exit(failures === 0 ? 0 : 1);
  }

  const { db } = await import('../lib/drizzle');

  const present = (await db.execute(sql`
    select to_regclass('public.platform_invoices') as invoices,
           to_regclass('public.super_admin_users') as admins,
           to_regclass('public.login_handoff_tokens') as handoffs`)) as unknown as Array<{
    invoices: string | null;
    admins: string | null;
    handoffs: string | null;
  }>;
  const column = (await db.execute(sql`
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'schools' and column_name = 'access_blocked_at'`)) as unknown as Array<{
    column_name: string;
  }>;

  const applied = present[0]?.invoices != null && present[0]?.admins != null && present[0]?.handoffs != null;
  const columnApplied = column.length === 1;
  console.log(`\n0052 is ${applied && columnApplied ? 'APPLIED' : 'NOT applied'} — tables ${applied ? 'present' : 'absent'}, schools.access_blocked_at ${columnApplied ? 'present' : 'absent'}`);

  const newTable = afterMigration(applied, UNDEFINED_TABLE);
  const newColumn = afterMigration(columnApplied, UNDEFINED_COLUMN);

  const queries = await import('../lib/platform-billing-queries');
  const central = await import('../lib/central-signin');
  const accounts = await import('../lib/super-admin-accounts');
  const { schoolSessionFor } = await import('../lib/school-auth');

  console.log('\nStatements over tables that already exist:');
  await mustRun('billableUserCounts — the one grouped query behind the Users column (E2)', () =>
    queries.billableUserCounts([TENANT, `${TENANT}-2`]),
  );
  await mustRun('schoolAdminEmail — the block/unblock and invoice recipient', () => queries.schoolAdminEmail(TENANT));
  await mustRun('candidateEmailsFor — a bare student ID', () => central.candidateEmailsFor('no-such-student-0000'));
  await mustRun('membershipsFor — school_users ⋈ schools, for the apex chooser', () => central.membershipsFor(NOBODY));
  await mustRun('activeMembershipAt — re-checked at redemption', () => central.activeMembershipAt(TENANT, NOBODY));

  const counted = queries.billableUserCountsSql([TENANT]);
  assert(
    'E2: the count statement excludes parents and inactive rows',
    /"role" <> \$\d/.test(counted.sql) && counted.params.includes('parent') && /"is_active" = \$\d/.test(counted.sql),
    counted.sql,
  );

  console.log('\nThe column 0052 adds to `schools`:');
  await newColumn('membershipFor — the per-request read now carries access_blocked_at', async () => {
    const fakeUser = { id: NOBODY, app_metadata: {} } as unknown as Parameters<typeof schoolSessionFor>[0];
    return schoolSessionFor(fakeUser, TENANT);
  });
  await newTable('overdueBlockingCandidates — invoices ⋈ settings ⋈ schools (blocked_at IS NULL)', () =>
    queries.overdueBlockingCandidates('2026-11-13'),
  );

  console.log('\nStatements 0052’s tables are for:');
  await newTable('getBillingSettings', () => queries.getBillingSettings(TENANT));
  await newTable('defaultInvoiceRecipient — settings, then the administrator', () => queries.defaultInvoiceRecipient(TENANT));
  await newTable('listPlatformInvoices — invoices ⋈ schools', () => queries.listPlatformInvoices({ locationId: TENANT }));
  for (const status of ['draft', 'due', 'overdue', 'paid', 'carried_forward'] as const) {
    await newTable(`listPlatformInvoices — status ${status}`, () => queries.listPlatformInvoices({ status, month: '2026-10' }));
  }
  await newTable('getPlatformInvoiceDetail — an id that is nobody’s', () => queries.getPlatformInvoiceDetail(NOBODY));
  await newTable('listPlatformBankAccounts', () => queries.listPlatformBankAccounts());
  await newTable('overdueUnclearedInvoices — the unblock test', () => queries.overdueUnclearedInvoices(TENANT, '2026-11-13', 2));
  await newTable('invoiceGenerationCandidates — settings ⋈ schools, then invoices', () =>
    queries.invoiceGenerationCandidates({ start: '2026-10-01', end: '2026-10-31' }),
  );
  await newTable('trialReminderCandidates — settings ⋈ schools', () => queries.trialReminderCandidates());
  await newTable('lastManualUnblocks — the manual Unblock the sweep must respect', () =>
    queries.lastManualUnblocks([TENANT]),
  );
  await newTable('superAdminTableState — keyed on the owner row', () => accounts.superAdminTableState());
  await newTable('getSuspendedView — the administrator’s unpaid invoices and the banks', () => queries.getSuspendedView(TENANT));
  await newTable('invoiceBelongsTo — the school-side PDF’s tenancy test', () => queries.invoiceBelongsTo(NOBODY, TENANT));
  await newTable('listSuperAdmins', () => accounts.listSuperAdmins());
  await newTable('findSuperAdminByEmail', () => accounts.findSuperAdminByEmail('nobody@sprint35.invalid'));
  await newTable('findSuperAdminById', () => accounts.findSuperAdminById(NOBODY));

  const state = await accounts.superAdminTableState();
  if (applied) {
    assert('superAdminTableState reads the table', state === 'rows' || state === 'empty', state);
    console.log(`  --    super_admin_users is ${state === 'rows' ? 'seeded' : 'EMPTY — run scripts/apply-0052.mjs --apply to seed the owner'}`);
  } else {
    assert('superAdminTableState reports unreachable before 0052 — the owner falls back to the environment', state === 'unreachable', state);
  }

  console.log(
    '\n  --    NOT exercised: getSchoolBillingOverview and generateInvoiceForSchool return\n' +
      '        early for a school that does not exist; their reads are the functions above.\n' +
      '  --    NOT executed, because they write: generation, finalize, discounts, receipts,\n' +
      '        block/unblock, the hand-off claim and the reminder claim.',
  );

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} passed, ${String(failures)} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
