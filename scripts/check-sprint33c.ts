/**
 * Sprint 33c — the rules, then every new or widened statement, executed.
 *
 *     npm run check-sprint33c
 *
 * ── Part one needs no database ───────────────────────────────────────────
 * The rules this part turns on:
 *
 *   · **C1.** A lesson is a *version* of a cell. The unique index had to
 *     become **partial** or the first supersede is a `23505`, and its
 *     predicate has to be character-for-character the one the reads filter on
 *     — an index constraining a set the queries do not draw is a duplicate
 *     lesson with nothing refusing it.
 *   · **C1.** Every read filters on "live today", through operators and never
 *     a raw `` sql`` `` template. That rule is the one that kept every
 *     scheduled announcement in the product from ever being released.
 *   · **C2.** A receipt is a `kind` on the data, not a forked component, and
 *     it refuses to exist for a voucher no money has been taken against.
 *   · **C3.** `ReachableTarget` carries a role and a campus, a desk has
 *     **no** role, and the route still takes no search term.
 *   · **C4.** Arranging cover is a permission key with a migration behind it,
 *     the scope is the Part B chain and not a second resolver, and a
 *     substitution never writes `timetable_entries`.
 *
 * ── Part two executes against the real schema ────────────────────────────
 * Printing `toSQL()` proves the names; only a server proves a statement
 * (CLAUDE.md). An ambiguous column reference is a *planning* error — Postgres
 * raises 42702 when it resolves the query, not when it returns rows — so a
 * statement that has been read and not run is evidence about spelling and
 * nothing else. That is how 42702 shipped three times.
 *
 * The script reads whether `0049` is applied rather than being told, so one
 * command works on both sides of it. Before it, a statement touching the two
 * new columns must fail with exactly `42703` and one touching
 * `timetable_substitutions` with exactly `42P01` — **any other error is a real
 * defect wearing a predicted failure's clothes**.
 *
 * ── The C1 claim is asserted directly, not argued ────────────────────────
 * *"Every existing row is live, so every current read returns exactly what it
 * returns today."* With `0049` applied that is a countable fact and this
 * counts it: `count(*) filter (where effective_to is null and effective_from
 * <= current_date)` against `count(*)`. If it is ever short, some row has been
 * closed and some grid has quietly lost a lesson.
 *
 * Two traps, both paid for the first time this pattern was written: the
 * SQLSTATE is on the error's `cause` and not on the error, so reading `.code`
 * reports every failure as unpredicted; and a read that short-circuits before
 * it reaches the new column must be reported as *not exercised* rather than
 * passed.
 *
 * Reads `DATABASE_URL` from the main checkout's `.env.local`, because a
 * worktree has no env of its own.
 */

import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL !== undefined) return;

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
        return;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('DATABASE_URL not found — set it, or run from a checkout with .env.local');
}

/** A syntactically valid id that belongs to no tenant and no row. */
const NOBODY = '00000000-0000-0000-0000-000000000000';
const TENANT = 'no-such-tenant-sprint33c';
/** A weekday, so nothing short-circuits on "that is a Saturday". */
const A_MONDAY = '2026-09-14';

/** "Undefined table" and "undefined column" — what `0049` fixes. */
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
  else fail(label, detail);
}

/** The SQLSTATE lives on the error's `cause` chain, not on the error. Trap 1. */
function sqlState(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** The reason, without postgres-js's copy of the whole statement. */
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

/** A statement whose execution is the whole assertion. */
async function mustRun(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    pass(
      label,
      Array.isArray(value)
        ? `${String(value.length)} row(s)`
        : value instanceof Map
          ? `${String(value.size)} key(s)`
          : 'executed',
    );
  } catch (error) {
    fail(label, `${sqlState(error) ?? '?'} ${reason(error)}`);
  }
}

/**
 * A statement that touches something `0049` adds.
 *
 * Applied: it must execute. Not applied: it must fail with **exactly** the
 * SQLSTATE predicted for it — `42703` for the two new columns on
 * `timetable_entries`, `42P01` for `timetable_substitutions`. A different one
 * is a different defect, and treating it as the predicted one is how a real
 * fault hides behind an expected failure.
 *
 * ⚠ A **list** is allowed and two statements need it. `listSectionDay` and
 * `listFreeTeachers` read the entries and the substitutions in one
 * `Promise.all`, so before `0049` whichever rejects first decides the code and
 * it is not deterministic which. Both are predicted and any *third* state is
 * still a failure — the point of this machinery is that the set of acceptable
 * errors is written down, not that it has one member.
 */
function afterMigration(applied: boolean, expected: string | readonly string[]) {
  const wanted = typeof expected === 'string' ? [expected] : [...expected];

  return async (label: string, run: () => Promise<unknown>): Promise<void> => {
    if (applied) {
      await mustRun(label, run);
      return;
    }

    try {
      await run();
      fail(label, 'it executed although 0049 is not applied — the prediction is wrong');
    } catch (error) {
      const state = sqlState(error);
      if (state !== null && wanted.includes(state)) {
        pass(label, `predicted ${state} — waiting on 0049`);
        return;
      }
      fail(
        label,
        `expected ${wanted.join(' or ')} before 0049, got ${state ?? '?'} ${reason(error)}`,
      );
    }
  };
}

/**
 * Source text, always LF.
 *
 * The repository is developed on Windows with `core.autocrlf=true`, so the
 * working tree is CRLF and git stores LF. A pattern anchored on `\n` therefore
 * matches in one checkout and silently matches **nothing** in another — the
 * same reason `check-branch-scope` and `check-sprint33b` normalise.
 */
const source = (path: string): string =>
  readFileSync(path, 'utf8').split('\r\n').join('\n');

async function main(): Promise<void> {
  /* ══════════════════════════════════════════════ part one: the rules */

  const { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS } =
    await import('../lib/permissions');

  const migration = source('db/migrations/0049_sprint33c_portal_work.sql');
  const historyLib = source('lib/timetable-history.ts');
  const entrySchema = source('db/schema/timetable-entries.ts');
  const entryRoute = source('app/api/school/timetable/entries/route.ts');

  console.log('\nC1 — a lesson is a version of a cell, and the past stops being edited:');

  assert(
    'the schema carries effective_from and effective_to',
    /effectiveFrom: date\('effective_from'\)/.test(entrySchema) &&
      /effectiveTo: date\('effective_to'\)/.test(entrySchema),
  );
  assert(
    '0049 adds both columns, and effective_from defaults to CURRENT_DATE',
    migration.includes('ADD COLUMN IF NOT EXISTS "effective_from" date DEFAULT CURRENT_DATE NOT NULL') &&
      migration.includes('ADD COLUMN IF NOT EXISTS "effective_to" date'),
    'without the default, every existing row reads as not-yet-in-force and every grid empties',
  );

  assert(
    '⚠ the unique index is DROPped and re-created PARTIAL',
    migration.includes('DROP INDEX IF EXISTS "timetable_entries_location_section_slot_day_idx"') &&
      /CREATE UNIQUE INDEX IF NOT EXISTS "timetable_entries_location_section_slot_day_idx"[\s\S]*?WHERE "effective_to" IS NULL AND "is_active"/.test(
        migration,
      ),
    'superseding writes a second row for the same cell — the first one is a 23505 without this',
  );
  assert(
    'and the Drizzle schema carries the same predicate',
    /uniqueIndex\('timetable_entries_location_section_slot_day_idx'\)[\s\S]*?\.where\(\s*sql`\$\{table\.effectiveTo\} IS NULL AND \$\{table\.isActive\}`/.test(
      entrySchema,
    ),
    'an index constraining a set the queries do not draw is a duplicate lesson nothing refuses',
  );

  assert(
    'the live predicate is built from operators, never a raw sql template',
    /lte\(timetableEntries\.effectiveFrom/.test(historyLib) &&
      /isNull\(timetableEntries\.effectiveTo\)/.test(historyLib) &&
      /gte\(timetableEntries\.effectiveTo/.test(historyLib) &&
      // The module does not even import `sql`, which is the only way to write
      // one. Matching on a backtick would match this rule's own prose — and
      // did, the first time this assertion was written.
      !/^import \{[^}]*\bsql\b[^}]*\} from 'drizzle-orm';$/m.test(historyLib),
    'CLAUDE.md: a value never reaches the driver through a raw sql template',
  );
  assert(
    'a superseded row is closed the day BEFORE the change lands',
    /at\.setUTCDate\(at\.getUTCDate\(\) - 1\)/.test(historyLib) &&
      migration.includes('CURRENT_DATE - 1'),
    'sharing the boundary date makes both versions live on it and draws the cell twice',
  );

  console.log('\nC1 — every current read filters on live today:');

  const readers = [
    'lib/academics-queries.ts',
    'lib/chat-queries.ts',
    'lib/dashboard-queries.ts',
    'lib/exam-queries.ts',
    'lib/kpi-access.ts',
    'lib/kpi-board.ts',
    'lib/report-queries.ts',
    'lib/teacher-calendar.ts',
  ];

  for (const path of readers) {
    const text = source(path);
    const reads = (text.match(/eq\(timetableEntries\.isActive, true\)/g) ?? []).length;
    const live = (text.match(/liveTimetableEntries\(/g) ?? []).length;
    assert(
      `${path} — every timetable read is scoped to the live version`,
      live >= Math.max(reads, 1),
      `${String(reads)} is_active filter(s), ${String(live)} live filter(s)`,
    );
  }

  assert(
    'the one file deliberately left alone is lib/payroll-approval.ts',
    !source('lib/payroll-approval.ts').includes('liveTimetableEntries'),
    'Sprint 33 does not touch payroll approval — STATE.md §5cc item 4 is with the product owner',
  );

  console.log('\nC1 — the save supersedes instead of overwriting:');

  assert(
    'a teacher or subject change closes the standing row and opens a new one',
    /const supersede =[\s\S]*?standing\.teacherId !== teacherId \|\| standing\.subjectId !== subjectId/.test(
      entryRoute,
    ),
  );
  assert(
    'both statements are built on `tx`, inside one batch',
    /batch\(db, \(tx\) => \[[\s\S]*?tx\s*\n?\s*\.update\(timetableEntries\)[\s\S]*?tx\.insert\(timetableEntries\)/.test(
      entryRoute,
    ),
    'a builder made from `db` runs outside the transaction even when awaited inside one',
  );
  assert(
    '⚠ the insert repeats the index predicate as targetWhere',
    /targetWhere: and\(\s*isNull\(timetableEntries\.effectiveTo\),\s*eq\(timetableEntries\.isActive, true\),\s*\)/.test(
      entryRoute,
    ),
    'Postgres cannot infer a PARTIAL index without it — the statement fails outright, not softly',
  );
  assert(
    'nothing updates a superseded row in place, and the DELETE only reaches the live one',
    source('app/api/school/timetable/entries/[id]/route.ts').includes('liveTimetableEntries()'),
  );

  console.log('\nC1 — the parent route:');

  const parentPage = source('app/(parent)/parent/timetable/page.tsx');
  assert(
    'it resolves the section’s own bell schedule',
    parentPage.includes('listSlotsForSection(') && !parentPage.includes('listTimetableSlots('),
    'CLAUDE.md: the unscoped call lays an infant class out against the senior school’s rows',
  );
  assert(
    'it repeats guardianOwnsStudent — the line between two families',
    parentPage.includes('guardianOwnsStudent('),
  );
  assert(
    'it is multi-child, through the shared selector',
    parentPage.includes('<ChildSelector') && parentPage.includes('listChildrenForGuardian('),
  );
  assert(
    'it has a loading.tsx using a Skeleton shape',
    /Skeleton(PageHeader|Table)/.test(source('app/(parent)/parent/timetable/loading.tsx')),
  );
  assert(
    'and the sidebar links to it, between Results and Fees',
    /'\/parent\/results'[\s\S]*?'\/parent\/timetable'[\s\S]*?'\/parent\/fees'/.test(
      source('components/parent/parent-nav.ts'),
    ),
    'a complete route with no caller passes every gate — STATE.md’s standing lesson',
  );

  console.log('\nC2 — a paid voucher prints a receipt, and it is not a fork:');

  const printView = source('components/fees/ChallanPrintView.tsx');
  const printData = source('lib/voucher-print-data.ts');

  assert(
    'the receipt is a `kind` on the data, not a second component',
    /kind\?: 'voucher' \| 'receipt'/.test(printView) &&
      (printView.match(/export function Challan(PrintView|Copies)/g) ?? []).length === 2,
    'Sprint 20 collapsed three hand-built spreads into one helper; a fork undoes exactly that',
  );
  assert(
    'the voucher and the receipt are assembled by one shared function',
    /function assemble\(/.test(printData) &&
      (printData.match(/assemble\(challan/g) ?? []).length === 2,
  );
  assert(
    'a receipt prints no bank block and no "valid upto"',
    /const banks = isReceipt \? \[\] : \(data\.banks \?\? \[\]\);/.test(printView) &&
      /isReceipt \? \(\s*<Stamp\s*label="Paid on"/.test(printView),
  );
  assert(
    'it prints every payment with its date, mode, reference and amount',
    /Received on[\s\S]*?Mode[\s\S]*?Reference[\s\S]*?Amount \(PKR\)/.test(printView),
  );
  assert(
    'outstanding is a literal zero on a receipt',
    /Outstanding[\s\S]*?formatAmount\('0'\)/.test(printView),
  );
  assert(
    'the month is on BOTH documents, from billing_month/billing_year',
    /\{isReceipt \? 'Payment for' : 'Fee for'\}/.test(printView) &&
      /function billingPeriod\(data: ChallanPrintData\)/.test(printView),
  );
  const choice = source('components/fees/ChallanPrintChoice.tsx');
  assert(
    '⚠ only one PrintSheet is ever mounted, so Ctrl+P cannot print both',
    /export function ChallanPrintSheet\(\)/.test(choice) &&
      // Two renders, two `active ===` guards, and an early `return` on each:
      // there is no path on which both reach the tree.
      (choice.match(/<ChallanPrintView data=/g) ?? []).length === 2 &&
      (choice.match(/if \(active === '(voucher|receipt)' && \w+ !== null\) return <ChallanPrintView/g) ??
        []).length === 2,
    'two sheets on one page are a demand and a receipt for the same money, on the same paper',
  );
  for (const screen of [
    'app/(parent)/parent/fees/page.tsx',
    'app/(school-admin)/dashboard/fees/challans/[challanId]/page.tsx',
  ]) {
    assert(
      `${screen} offers both documents through the shared helpers`,
      source(screen).includes('buildReceiptPrintData(') &&
        source(screen).includes('ChallanPrintButtons'),
    );
  }
  assert(
    'the bulk run prints receipts too, through the same helper',
    source('app/(school-admin)/dashboard/fees/challans/print/page.tsx').includes(
      'buildReceiptPrintData(',
    ) && source('components/fees/ChallanTable.tsx').includes("challanPrintHref(selectedIds, 'receipt')"),
  );

  /*
   * The refusals, exercised rather than read. `buildReceiptPrintData` is pure,
   * so it can be called here with a fabricated voucher — which is the only
   * assertion in this file that proves the *behaviour* of the rule rather than
   * the presence of the code implementing it.
   */
  const { buildReceiptPrintData } = await import('../lib/voucher-print-data');

  const skeletonChallan = {
    challanNumber: 'FC-0001',
    schoolName: 'A School',
    schoolAddress: null,
    schoolPhone: null,
    schoolEmail: null,
    schoolNtn: null,
    schoolWebsite: null,
    schoolFinanceEmail: null,
    studentEmail: null,
    branchId: null,
    branchName: null,
    branchAddress: null,
    branchPhone: null,
    branchEmail: null,
    notes: null,
    rollNumber: null,
    academicYearId: NOBODY,
    academicYearName: '2026-27',
    id: NOBODY,
    studentProfileId: NOBODY,
    studentName: 'A Pupil',
    studentId: 'S-1',
    gradeName: 'Class 5',
    sectionName: 'A',
    billingMonth: 9,
    billingYear: 2026,
    challanKind: 'monthly',
    dueDate: '2026-09-10',
    issueDate: '2026-09-01',
    subtotal: '5000.00',
    concessionAmount: '0.00',
    creditApplied: '0.00',
    lateFeeAmount: '0.00',
    totalAmount: '5000.00',
    paidAmount: '5000.00',
    items: [],
    guardian: null,
    payments: [
      {
        id: NOBODY,
        amount: '2000.00',
        paymentMethod: 'cash' as const,
        referenceNumber: null,
        paymentDate: '2026-09-08',
        collectedByUid: 'uid',
        collectedByName: null,
        notes: null,
        createdAt: new Date(),
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        amount: '3000.00',
        paymentMethod: 'bank_transfer' as const,
        referenceNumber: 'TRX-9',
        paymentDate: '2026-09-02',
        collectedByUid: 'uid',
        collectedByName: null,
        notes: null,
        createdAt: new Date(),
      },
    ],
  };

  type Detail = Parameters<typeof buildReceiptPrintData>[0];

  const paidReceipt = buildReceiptPrintData(
    { ...skeletonChallan, status: 'paid' } as unknown as Detail,
    { logoUrl: null },
  );

  assert('a paid voucher yields a receipt', paidReceipt?.kind === 'receipt');
  assert(
    'with no bank block, no valid-upto and no after-due-date figure on it',
    paidReceipt !== null &&
      (paidReceipt.banks ?? []).length === 0 &&
      paidReceipt.validUpto === null &&
      paidReceipt.lateFeeAfterDueDate === null,
  );
  assert(
    'the payments are listed oldest first, so "Paid on" is the last one',
    paidReceipt?.payments?.[0]?.paymentDate === '2026-09-02' &&
      paidReceipt.payments[1]?.paymentDate === '2026-09-08',
  );
  assert(
    'the mode is in the school’s own words, not the enum',
    paidReceipt?.payments?.[1]?.method === 'Cash',
    String(paidReceipt?.payments?.[1]?.method),
  );
  assert(
    'a partially paid voucher yields BOTH documents',
    buildReceiptPrintData({ ...skeletonChallan, status: 'partial' } as unknown as Detail, {
      logoUrl: null,
    })?.kind === 'receipt',
  );
  assert(
    'an unpaid voucher yields no receipt at all',
    buildReceiptPrintData({ ...skeletonChallan, status: 'unpaid' } as unknown as Detail, {
      logoUrl: null,
    }) === null,
    'a receipt for nothing is the mirror of a demand for settled money',
  );
  assert(
    'nor does a "paid" voucher with no payment rows behind it',
    buildReceiptPrintData(
      { ...skeletonChallan, status: 'paid', payments: [] } as unknown as Detail,
      { logoUrl: null },
    ) === null,
  );

  console.log('\nC3 — the recipient picker:');

  const chatLib = source('lib/chat-queries.ts');
  const workspace = source('components/chat/ChatWorkspace.tsx');

  assert(
    'ReachableTarget carries a role and a campus',
    /role: UserRole \| null;/.test(chatLib) && /branchName: string \| null;/.test(chatLib),
  );
  assert(
    'a desk has NO role, and the type is honest about it',
    /role: null,\s*\n\s*branchName: null,\s*\n\s*detail: 'The school will answer'/.test(chatLib),
    'labelling the Accounts Office `accountant` would be a guess printed as a fact',
  );
  assert(
    'all four branches populate them',
    (chatLib.match(/role: 'teacher',/g) ?? []).length === 2 &&
      /role: row\.role as UserRole,/.test(chatLib) &&
      (chatLib.match(/withBranchNames\(/g) ?? []).length === 3,
  );
  assert(
    'a student target shows the parent’s name and the class',
    /async function studentContextFor\(/.test(chatLib) && /parts\.join\(' · '\)/.test(chatLib),
  );
  assert(
    'a parent target shows their children’s names',
    /async function childrenOfParents\(/.test(chatLib),
  );
  assert(
    '⚠ the route still takes no search term — it is not a directory',
    !/searchParams\.get/.test(source('app/api/school/chat/reachable/route.ts')),
  );
  assert(
    'the search filters client-side over the already-resolved list',
    /function matchesSearch\(/.test(workspace) && /const visibleTargets = useMemo\(/.test(workspace),
  );
  assert(
    'role chips filter it, and are derived from the list rather than from USER_ROLES',
    /const targetGroups = useMemo\(/.test(workspace) && /aria-pressed=\{active\}/.test(workspace),
  );
  assert(
    'a recipient filtered away is cleared, never left selected invisibly',
    /setTargetKey\(''\);\s*\n\s*\}, \[visibleTargets, targetKey\]\)/.test(workspace),
    'otherwise the send posts to somebody whose name is no longer on screen',
  );
  assert(
    'an empty list still shows the reply-only sentence, not an empty chip row',
    workspace.includes('You can\n                still reply to anything the school sends you.') ||
      /targets\.length === 0 \? \(\s*<p[\s\S]{0,200}still reply/.test(workspace),
  );
  assert(
    'initiateProblem still re-derives on the write',
    source('lib/chat-threads.ts').includes('await initiateProblem('),
    'the labels are a courtesy; the server stays the rule',
  );
  assert(
    'one component, so all four portals get it',
    ['app/(school-admin)/dashboard/chat/page.tsx', 'app/(teacher)/teacher/chat/page.tsx',
     'app/(parent)/parent/chat/page.tsx', 'app/(student)/student/chat/page.tsx'].every((path) =>
      source(path).includes('<ChatWorkspace'),
    ),
  );

  console.log('\nC4 — teacher availability and quick substitutes:');

  const availability = source('lib/teacher-availability.ts');
  const substitutesRoute = source('app/api/school/timetable/substitutes/route.ts');

  assert(
    'timetable.substitute is in the catalogue, labelled and on the matrix',
    (PERMISSIONS as readonly string[]).includes('timetable.substitute') &&
      (PERMISSION_LABELS['timetable.substitute'] ?? '') !== '' &&
      PERMISSION_GROUPS.some((group) =>
        (group.permissions as readonly string[]).includes('timetable.substitute'),
      ),
  );
  assert(
    '⚠ and 0049 widens role_permissions_permission_check with the full list',
    migration.includes('DROP CONSTRAINT IF EXISTS "role_permissions_permission_check"') &&
      migration.includes('ADD CONSTRAINT "role_permissions_permission_check"') &&
      PERMISSIONS.every((key) => migration.includes(`'${key}'`)),
    'a key without the migration is a 23514 the first time a school overrides the default',
  );

  const holds = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS, key: string): boolean =>
    (DEFAULT_ROLE_PERMISSIONS[role] as readonly string[]).includes(key);

  assert(
    'the spec’s four roles hold it by default',
    (['principal', 'vice_principal', 'section_head', 'coordinator'] as const).every((role) =>
      holds(role, 'timetable.substitute'),
    ),
  );
  assert(
    'a teacher, a parent and a pupil do not',
    (['teacher', 'parent', 'student'] as const).every(
      (role) => !holds(role, 'timetable.substitute'),
    ),
  );
  assert(
    'the panel is gated on the key, never on a role list',
    /permissions\.includes\('timetable\.substitute'\)/.test(
      source('app/(school-admin)/dashboard/(home)/page.tsx'),
    ) && !/ADMIN_PORTAL_ROLES\.includes[\s\S]{0,80}SubstitutePanel/.test(
      source('app/(school-admin)/dashboard/(home)/page.tsx'),
    ),
  );
  assert(
    'and so is the route, on both verbs',
    (substitutesRoute.match(/permission: 'timetable\.substitute'/g) ?? []).length === 2,
  );

  assert(
    'the clash test is the A1 helper, so the form, the route and this ask one function',
    availability.includes('slotsOverlap('),
  );
  assert(
    'leave is read through the existing bulk reader, not a second one',
    availability.includes('listLeaveForSchool(') && !availability.includes('from(leaveRequests)'),
  );
  assert(
    'holidays and the Saturday roster are subtracted through the existing helpers',
    availability.includes('staffHolidayDates(') &&
      availability.includes('saturdayOrdinalsByStaff(') &&
      availability.includes('isWorkingDay('),
  );
  assert(
    'the scope is Part B’s chain of command, not a second resolver',
    availability.includes('reachableStaffIds(') && availability.includes('loadChainIndex('),
  );
  assert(
    '⚠ a substitution never rewrites timetable_entries',
    !/insert\(timetableEntries\)|update\(timetableEntries\)/.test(substitutesRoute) &&
      !/insert\(timetableEntries\)|update\(timetableEntries\)/.test(availability),
    'cover for one Tuesday written into the grid is cover for every Tuesday',
  );
  assert(
    'the write re-derives availability rather than trusting the panel',
    substitutesRoute.includes('substituteRefusal('),
  );
  assert(
    'one cover per cell per date, in the schema and in the migration',
    source('db/schema/timetable-substitutions.ts').includes(
      "uniqueIndex('timetable_substitutions_cell_date_idx')",
    ) && migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS "timetable_substitutions_cell_date_idx"'),
  );
  assert(
    'the table is tenant-keyed and the tenant column is indexed',
    migration.includes('"location_id" text NOT NULL REFERENCES "schools"("location_id")') &&
      migration.includes('CREATE INDEX IF NOT EXISTS "timetable_substitutions_location_id_idx"'),
  );
  assert(
    'the teacher is told through the bell and, where chat is on, through chat',
    source('lib/substitute-notifier.ts').includes('await notify(') &&
      source('lib/substitute-notifier.ts').includes('openThread(') &&
      source('lib/substitute-notifier.ts').includes('getModuleFlags('),
  );
  assert(
    'and a failed notice never turns an arranged substitution into a 500',
    (source('lib/substitute-notifier.ts').match(/catch \(error\) \{/g) ?? []).length === 2,
  );

  /* ══════════════════════════════════ part two: against the real schema */

  loadDatabaseUrl();
  const { db } = await import('../lib/drizzle');

  const columns = (await db.execute(sql`
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'timetable_entries'
       and column_name in ('effective_from', 'effective_to')`)) as unknown as Array<{
    column_name: string;
  }>;

  const tables = (await db.execute(sql`
    select to_regclass('public.timetable_substitutions') as substitutions`)) as unknown as Array<{
    substitutions: string | null;
  }>;

  const columnsApplied = columns.length === 2;
  const tableApplied = tables[0]?.substitutions != null;

  console.log(
    `\n0049 is ${columnsApplied && tableApplied ? 'APPLIED' : 'NOT applied'} — timetable_entries columns ${String(
      columns.length,
    )}/2, timetable_substitutions ${tableApplied ? 'present' : 'absent'}`,
  );

  const newColumn = afterMigration(columnsApplied, UNDEFINED_COLUMN);
  const newTable = afterMigration(tableApplied, UNDEFINED_TABLE);
  // Statements that need both halves of `0049`. See `afterMigration`.
  const newEither = afterMigration(columnsApplied && tableApplied, [
    UNDEFINED_COLUMN,
    UNDEFINED_TABLE,
  ]);

  const academics = await import('../lib/academics-queries');
  const chat = await import('../lib/chat-queries');
  const exams = await import('../lib/exam-queries');
  const dashboard = await import('../lib/dashboard-queries');
  const substitutes = await import('../lib/teacher-availability');

  console.log('\nStatements over tables that already exist:');

  await mustRun('listSubstituteSections — sections ⋈ grades ⋈ branches', () =>
    substitutes.listSubstituteSections(TENANT, NOBODY, null),
  );
  await mustRun('listSubstituteSections — narrowed to a head’s grades', () =>
    substitutes.listSubstituteSections(TENANT, NOBODY, [NOBODY]),
  );
  /*
   * QA round 1, F3 and F4. The statement gained a `branches` LEFT JOIN and an
   * `ownedBy(grades.branch_id, …)` predicate, and it now joins four tables —
   * which is the count CLAUDE.md says to read the generated SQL at. Both
   * branch-scope shapes are executed, because `ownedBy` emits a *different*
   * statement for each: `undefined` (no predicate) for null, `false` for the
   * empty list, and an `IN` otherwise. The empty case is the one that would
   * silently widen rather than narrow if it were ever wrong.
   */
  await mustRun('listSubstituteSections — narrowed to one campus (ownedBy → IN)', () =>
    substitutes.listSubstituteSections(TENANT, NOBODY, null, [NOBODY]),
  );
  await mustRun('listSubstituteSections — a scope reaching no campus (ownedBy → false)', () =>
    substitutes.listSubstituteSections(TENANT, NOBODY, null, []),
  );
  await mustRun('reachableTeachers — listFileableStaff ⋈ the chain index', () =>
    substitutes.reachableTeachers(TENANT, { schoolUserId: NOBODY, role: 'coordinator' }, null),
  );
  await mustRun('studentContextFor — the parent’s name and the class, in two reads', () =>
    chat.studentContextFor(TENANT, [NOBODY]),
  );
  await mustRun('childrenOfParents — student_guardians ⋈ profiles ⋈ school_users', () =>
    chat.childrenOfParents(TENANT, [NOBODY]),
  );
  await mustRun('resolveReachable — staff, the widened directory read', () =>
    chat.resolveReachable(TENANT, { schoolUserId: NOBODY, role: 'coordinator' }),
  );

  console.log('\nStatements 0049’s two columns on `timetable_entries` are for:');

  await newColumn('listTimetableEntries — one section’s week, as the grid draws it', () =>
    academics.listTimetableEntries(TENANT, { sectionId: NOBODY, academicYearId: NOBODY }),
  );
  await newColumn('listSlotsForTeacher — the structures a teacher actually teaches in', () =>
    academics.listSlotsForTeacher(TENANT, NOBODY, NOBODY),
  );
  await newColumn('listTeacherTimetable — one teacher’s own week', () =>
    academics.listTeacherTimetable(TENANT, NOBODY, NOBODY),
  );
  await newColumn('listTeacherBusySlots — the clash guard’s input', () =>
    academics.listTeacherBusySlots(TENANT, NOBODY, NOBODY),
  );
  await newColumn('listTeacherOverlaps — the A1 report', () =>
    academics.listTeacherOverlaps(TENANT, NOBODY),
  );
  await newColumn('listTeacherOverlaps — narrowed to a head’s grades', () =>
    academics.listTeacherOverlaps(TENANT, NOBODY, { gradeIds: [NOBODY] }),
  );
  await newColumn('listTeacherSections — the teacher portal’s authorisation list', () =>
    academics.listTeacherSections(TENANT, NOBODY, NOBODY),
  );
  await newColumn('teacherTeachesSection — the register guard', () =>
    academics.teacherTeachesSection(TENANT, NOBODY, NOBODY, NOBODY),
  );
  await newColumn('teachersOfChildren — the parent’s reachability join', () =>
    chat.teachersOfChildren(TENANT, NOBODY, NOBODY),
  );
  await newColumn('teachersOfStudent — the pupil’s', () =>
    chat.teachersOfStudent(TENANT, NOBODY, NOBODY),
  );
  await newColumn('listTeacherPapers — the marks-entry list, gated on the grid', () =>
    exams.listTeacherPapers(TENANT, NOBODY, NOBODY),
  );
  await newColumn('teacherOwnsPaper — the marks-entry guard', () =>
    exams.teacherOwnsPaper(TENANT, NOBODY, NOBODY),
  );
  await newColumn('listTeacherScheduleRows — the teacher’s datesheet', () =>
    exams.listTeacherScheduleRows(TENANT, NOBODY, NOBODY),
  );
  await newColumn('getSetupProgress — timetableCoverage counts sections with a grid', () =>
    dashboard.getSetupProgress(TENANT),
  );
  /*
   * QA round 1, F1. `/parent/timetable` called `getStudentPlacement` — whose
   * second parameter is a `school_users.id` — with a `student_profiles.id`.
   * Both are `string`, so it compiled, returned 200, logged nothing, and
   * resolved to null for **every child at every school**. `check-sprint33c`
   * executed the statement and still could not see it, because executing the
   * *wrong function* proves only that the wrong function runs.
   *
   * So both are executed here, adjacent and named for the column each filters
   * on. That does not catch a swap either — nothing mechanical can — but it
   * puts the distinction in front of whoever edits this file next, which is
   * the only defence a pair of same-typed ids has.
   */
  await newColumn('getStudentPlacement — filters student_profiles.SCHOOL_USER_ID', () =>
    academics.getStudentPlacement(TENANT, NOBODY, NOBODY),
  );
  await newColumn('getPlacementForStudentProfile — filters student_profiles.ID', () =>
    academics.getPlacementForStudentProfile(TENANT, NOBODY, NOBODY),
  );

  console.log('\nStatements 0049’s new table is for:');

  /*
   * The table on its own, straight off the Drizzle schema.
   *
   * Every other statement below reaches it through a function that also touches
   * `timetable_entries`, so this is the one that proves the *columns* are what
   * `db/schema/timetable-substitutions.ts` says they are — a table created with
   * a column the schema does not declare fails here and nowhere else.
   */
  const { timetableSubstitutions } = await import('../db/schema');
  const { eq } = await import('drizzle-orm');

  await newTable('timetable_substitutions — every column the schema declares', () =>
    db
      .select()
      .from(timetableSubstitutions)
      .where(eq(timetableSubstitutions.locationId, TENANT))
      .limit(1),
  );

  await newEither('listSectionDay — the day’s lessons and the cover already arranged', () =>
    substitutes.listSectionDay(TENANT, {
      sectionId: NOBODY,
      academicYearId: NOBODY,
      date: A_MONDAY,
    }),
  );

  /*
   * `listFreeTeachers` reads the slot first and returns null when it finds
   * none, so a tenant that owns nothing never reaches the four statements this
   * check exists for. A real slot id is read out of the catalogue and used with
   * a candidate list of one id that matches nobody: every statement plans and
   * executes, and every one of them returns no rows.
   */
  const slotRows = (await db.execute(sql`
    select id, location_id from timetable_slots limit 1`)) as unknown as Array<{
    id: string;
    location_id: string;
  }>;

  const slot = slotRows[0];

  if (slot === undefined) {
    console.log(
      '  --    listFreeTeachers NOT EXERCISED — this database holds no timetable_slots row,\n' +
        '        so the slot lookup returns null before the four reads it exists for.',
    );
  } else {
    await newEither(
      'listFreeTeachers — the lesson clash, the cover clash, the leave and the calendar',
      () =>
        substitutes.listFreeTeachers(slot.location_id, {
          date: A_MONDAY,
          slotId: slot.id,
          academicYearId: NOBODY,
          candidates: [
            {
              schoolUserId: NOBODY,
              staffId: NOBODY,
              name: 'nobody',
              branchId: null,
              branchName: null,
            },
          ],
        }),
    );
  }

  /*
   * The C1 claim, counted rather than argued.
   *
   * Every row that existed before `0049` reads `effective_from = CURRENT_DATE`
   * through `attmissingval` and `effective_to = NULL`, so the live set and the
   * whole table are the same set. If they ever differ by more than the rows a
   * school has deliberately superseded, a grid has lost a lesson.
   */
  console.log('\nThe C1 compatibility claim, counted:');

  if (!columnsApplied) {
    pass('not countable yet', '0049 is unapplied, so there are no dates to count');
  } else {
    const counts = (await db.execute(sql`
      select count(*)::int                                                          as total,
             count(*) filter (where effective_to is null)::int                      as open,
             count(*) filter (where effective_to is null
                                and effective_from <= current_date)::int            as live,
             count(*) filter (where effective_to is not null)::int                  as superseded
        from timetable_entries`)) as unknown as Array<{
      total: number;
      open: number;
      live: number;
      superseded: number;
    }>;

    const row = counts[0];
    assert(
      'every row with no end date is live today',
      row !== undefined && row.open === row.live,
      JSON.stringify(row),
    );
    assert(
      'live + superseded accounts for every row in the table',
      row !== undefined && row.live + row.superseded === row.total,
      JSON.stringify(row),
    );
    console.log(
      `  --    ${String(row?.total ?? 0)} entries: ${String(row?.live ?? 0)} live, ${String(
        row?.superseded ?? 0,
      )} superseded. Before any teacher change, superseded is 0 and live is every row.`,
    );

    const indexes = (await db.execute(sql`
      select indexname, indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'timetable_entries'
         and indexname = 'timetable_entries_location_section_slot_day_idx'`)) as unknown as Array<{
      indexname: string;
      indexdef: string;
    }>;

    const definition = indexes[0]?.indexdef ?? '';
    assert(
      '⚠ the live index is UNIQUE and PARTIAL, not the old whole-table one',
      /CREATE UNIQUE INDEX/.test(definition) &&
        /WHERE \(\(effective_to IS NULL\) AND is_active\)/.test(definition),
      definition === '' ? 'the index is missing entirely' : definition,
    );
  }

  console.log(
    '\n  --    getTeacherCalendar is NOT exercised here: it reads the teacher row first and\n' +
      '        returns null for a tenant that owns none, so it never reaches its timetable\n' +
      '        join. That join is listTeacherTimetable’s, executed above.\n' +
      '  --    kpi-access’s `resolveTeacherPrincipals` and report-queries’ `subjectAttendance`\n' +
      '        are NOT exercised: the first **writes** (it ends and re-derives\n' +
      '        `teacher_principals`) and the second is private behind `runReport`. Both carry\n' +
      '        the same one-line predicate as the twelve statements above, and\n' +
      '        `npm run check-reports` and `npm run check-dashboard` execute them for real.\n' +
      '  --    resolveReachable for a parent and a pupil short-circuits on "no active year",\n' +
      '        which is why teachersOfChildren and teachersOfStudent are called directly.\n' +
      '  --    Nothing here writes. The substitutes POST, postMessage and notifySubstitute are\n' +
      '        asserted by source and by shape; check-sprint24 records why a check script does\n' +
      '        not issue an INSERT against a live database.',
  );

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} passed, ${String(failures)} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
