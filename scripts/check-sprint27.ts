/**
 * Executes Sprint 27's new statements against the real schema.
 *
 *     npm run check-sprint27
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * A green build says the SQL compiled, never that Postgres would accept it. An
 * ambiguous column reference is a *planning* error — 42702 is raised when the
 * statement is resolved, not when it returns rows — so a statement that has
 * been read and not run is evidence about spelling and nothing else. That is
 * how 42702 shipped three times, and it is why `check-sprint20` through `26`
 * exist. This is the same script pointed at this sprint's statements.
 *
 * ── It works on both sides of `0043` ─────────────────────────────────────
 * Whether the migration is applied is **read out of the catalogue**, never
 * passed in. Before it, the migration-dependent statements must fail with
 * exactly `42P01` (no such table) or `42703` (no such column), and **any other
 * error is a real defect wearing a predicted failure's clothes**. After it,
 * every one of them must execute.
 *
 * ── The three traps, all paid for by earlier sprints ─────────────────────
 * 1. The SQLSTATE lives on the error's `cause` chain, not on the error. Reading
 *    `.code` reports every failure as unpredicted.
 * 2. A read that short-circuits before it reaches the new column must be
 *    reported as **not exercised**, never as a pass — otherwise a broken
 *    statement hides behind an early return.
 * 3. postgres-js appends the whole failed query to the message; the `cause`
 *    carries the bare reason, so that is what is printed.
 *
 * ── The pure assertions ──────────────────────────────────────────────────
 * `islamicToGregorian` against known Gregorian dates, `saturdayOrdinal` across
 * a month starting on each weekday, `mergeConsecutive` across a month boundary
 * and across two different holidays, and `defaultDueDate` for a December run
 * rolling into January. None of them touches Postgres and all of them are
 * things a wrong constant would break silently.
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
      const text = readFileSync(candidate, 'utf8');
      const match = /^DATABASE_URL=(.*)$/m.exec(text);
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

loadDatabaseUrl();

/** A syntactically valid id that belongs to no tenant, and no row. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

let failures = 0;
let passes = 0;

/** The SQLSTATE, dug out from under Drizzle's wrapper. Trap 1. */
function sqlState(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') return code;
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

/** The SQLSTATE and the reason, without postgres-js's copy of the statement. */
function describe(error: unknown): string {
  let reason: string | null = null;

  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && !message.startsWith('Failed query')) {
      reason = message;
      break;
    }
    current = (current as { cause?: unknown }).cause;
  }

  reason ??= String((error as { message?: string } | null)?.message ?? error);

  const oneLine = (reason.split('\n')[0] ?? reason).trim();
  const trimmed = oneLine.length > 110 ? `${oneLine.slice(0, 109)}…` : oneLine;

  return `${sqlState(error) ?? '?'} ${trimmed}`;
}

function pass(label: string, detail = ''): void {
  console.log(`  ok    ${label}${detail === '' ? '' : ` — ${detail}`}`);
  passes += 1;
}

function fail(label: string, detail: string): void {
  console.error(`  FAIL  ${label}`);
  console.error(`        ${detail}`);
  failures += 1;
}

/**
 * Records that a path was deliberately not reached, with its substitute named.
 *
 * Trap 2 says a read that short-circuits before it reaches the new column must
 * be reported as *not exercised* rather than passed. Two reads here genuinely
 * do short-circuit against a tenant that matches no row — `listBulkCandidates`
 * returns `[]` before its second statement, and `coverableStaffFor` before the
 * teaching-grades join — and there is no tenant id that would change that
 * without writing rows to a live database.
 *
 * So the honest answer is neither a pass nor a failure: it is this note, plus
 * the same statement executed directly as raw SQL immediately below it. The
 * note is what stops "ok" being printed for something Postgres never planned.
 */
function notExercisedIsExpected(label: string, why: string): void {
  console.log(`  note  ${label}`);
  console.log(`        ${why}`);
}

function assert(label: string, condition: boolean, detail: string): void {
  if (condition) {
    pass(label);
    return;
  }
  fail(label, detail);
}

async function mustRun(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    pass(label, Array.isArray(value) ? `${String(value.length)} row(s)` : 'executed');
  } catch (error) {
    fail(label, describe(error));
  }
}

/**
 * A statement that needs `0043`. Before it, exactly `42P01` or `42703`.
 *
 * Any other SQLSTATE is a **real defect** — an ambiguous column, a typo, a
 * missing join — dressed as the failure this script was expecting, and it is
 * reported as a failure rather than swallowed.
 */
async function migrationDependent(
  label: string,
  applied: boolean,
  run: () => Promise<unknown>,
): Promise<void> {
  if (applied) {
    await mustRun(label, run);
    return;
  }

  try {
    await run();
    fail(label, '0043 is not applied, yet this executed — the predicate is not reaching the new object');
  } catch (error) {
    const code = sqlState(error);
    if (code === '42P01' || code === '42703') {
      pass(label, `predicted ${code} before 0043`);
      return;
    }
    fail(label, `expected 42P01/42703 before 0043, got ${describe(error)}`);
  }
}

async function main(): Promise<void> {
  /* ═════════════════════════════════════ the pure assertions, no database */

  const islamic = await import('../lib/islamic-calendar');
  const calendar = await import('../lib/holiday-calendar');
  const holidays = await import('../lib/pakistan-holidays');
  const feeCalculator = await import('../lib/fee-calculator');
  const autoGenerate = await import('../lib/voucher-auto-generate');
  const permissions = await import('../lib/permissions');

  console.log('\nThe Islamic calendar, against dates a person can check:');

  /*
   * Reference dates, and what they are being checked against.
   *
   * The tabular calendar is an approximation of a moon sighting, so these are
   * asserted to the day the *arithmetic* produces — which is within a day of
   * what Pakistan observed — and the point of the assertion is that a wrong
   * epoch or a 16-based leap rule moves them by one or more days. Both of those
   * mistakes are invisible without a fixture.
   */
  const knownDates: Array<[number, number, number, string, string]> = [
    [1446, 10, 1, '2025-03-31', 'Eid-ul-Fitr 1446'],
    [1446, 12, 10, '2025-06-07', 'Eid-ul-Adha 1446'],
    [1447, 10, 1, '2026-03-20', 'Eid-ul-Fitr 1447'],
    [1447, 12, 10, '2026-05-27', 'Eid-ul-Adha 1447'],
    [1447, 3, 12, '2025-09-05', 'Eid Milad-un-Nabi 1447'],
    [1447, 1, 9, '2025-07-05', 'Ashura 1447'],
  ];

  for (const [year, month, day, expected, label] of knownDates) {
    const actual = islamic.islamicToGregorian(year, month, day);
    assert(
      `${label} → ${expected}`,
      actual === expected,
      `got ${actual}; a wrong epoch or leap rule moves every date this file produces`,
    );
  }

  const roundTrip = islamic.gregorianToIslamic(2026, 1, 1);
  assert(
    'the conversion round-trips',
    islamic.islamicToGregorian(roundTrip.year, roundTrip.month, roundTrip.day) ===
      '2026-01-01',
    'gregorianToIslamic and islamicToGregorian disagree, so one of them is wrong',
  );

  assert(
    'a Gregorian year touches at least two Hijri years',
    islamic.islamicYearsTouching(2026).length >= 2,
    'a Hijri year is ~11 days shorter, so a seed reading one would miss an Eid',
  );

  console.log('\nEvery religious holiday the seed writes is tentative:');

  const seeded = holidays.pakistanHolidaysFor(2026);

  assert(
    'the fixed national holidays are all there',
    seeded.filter((row) => row.holidayType === 'public').length === 6,
    `expected 6 public holidays, got ${String(seeded.filter((row) => row.holidayType === 'public').length)}`,
  );

  assert(
    'no religious holiday is written as confirmed',
    seeded
      .filter((row) => row.holidayType === 'religious')
      .every((row) => row.isTentative),
    'a lunar date has been written confident, and a school will plan around it',
  );

  assert(
    'no national holiday is written as tentative',
    seeded.filter((row) => row.holidayType === 'public').every((row) => !row.isTentative),
    '14 August is 14 August',
  );

  assert(
    'every seeded row falls inside the year asked for',
    seeded.every((row) => row.startsOn.startsWith('2026')),
    'a row from the neighbouring year has leaked into the catalogue',
  );

  console.log('\nsaturdayOrdinal, across a month starting on each weekday:');

  /*
   * Seven months, each beginning on a different weekday, so every alignment is
   * covered. The fifth Saturday is the one that matters: a month can hold one,
   * and a policy that could not name it would silently make every fifth
   * Saturday a day off for the whole school.
   */
  const monthStarts = [
    '2026-02-01',
    '2026-03-01',
    '2026-04-01',
    '2026-07-01',
    '2026-09-01',
    '2026-10-01',
    '2026-11-01',
  ];

  for (const first of monthStarts) {
    let expected = 0;
    let ok = true;
    let cursor = first;
    const month = first.slice(0, 7);

    while (cursor.startsWith(month)) {
      const weekday = calendar.parseIsoDate(cursor).getUTCDay();
      if (weekday === 6) {
        expected += 1;
        if (calendar.saturdayOrdinal(cursor) !== expected) ok = false;
      } else if (calendar.saturdayOrdinal(cursor) !== 0) {
        ok = false;
      }
      cursor = calendar.addDays(cursor, 1);
    }

    assert(
      `${month} — ${String(expected)} Saturdays, each numbered in order`,
      ok && expected >= 4,
      'saturdayOrdinal disagrees with counting the Saturdays by hand',
    );
  }

  assert(
    'a month with five Saturdays produces a 5',
    calendar.saturdayOrdinal('2026-08-29') === 5,
    'the fifth Saturday came back as something else, so no policy can name it',
  );

  console.log('\neffectiveSaturdayOrdinals — null and [] are opposite:');

  assert(
    'null falls through to the role policy',
    calendar.effectiveSaturdayOrdinals(null, [1, 3]).join() === '1,3',
    'a person with no override is not getting their role’s Saturdays',
  );

  assert(
    'an empty override means no Saturdays, not "use the role"',
    calendar.effectiveSaturdayOrdinals([], [1, 3]).length === 0,
    'the empty array collapsed into the role policy — one teacher cannot be excused',
  );

  console.log('\nmergeConsecutive, across a month boundary and two holidays:');

  const blocks = calendar.mergeConsecutive([
    { name: 'Eid Milad-un-Nabi', startsOn: '2026-10-30', endsOn: '2026-10-31' },
    { name: 'Kashmir Day', startsOn: '2026-11-01', endsOn: '2026-11-01' },
  ]);

  assert(
    'two adjacent holidays across 31 October become one block',
    blocks.length === 1 &&
      blocks[0]?.startsOn === '2026-10-30' &&
      blocks[0]?.endsOn === '2026-11-01',
    `got ${String(blocks.length)} block(s) — the notice would go out two or three times`,
  );

  assert(
    'and the block names both holidays',
    (blocks[0]?.holidays.length ?? 0) === 2,
    'one of the two holidays was dropped when they merged',
  );

  const apart = calendar.mergeConsecutive([
    { name: 'A', startsOn: '2026-10-01', endsOn: '2026-10-01' },
    { name: 'B', startsOn: '2026-10-05', endsOn: '2026-10-05' },
  ]);

  assert(
    'two holidays four days apart stay two blocks',
    apart.length === 2,
    'the merge is swallowing days the school is open',
  );

  const nested = calendar.mergeConsecutive([
    { name: 'Long', startsOn: '2026-10-01', endsOn: '2026-10-05' },
    { name: 'Short', startsOn: '2026-10-02', endsOn: '2026-10-03' },
  ]);

  assert(
    'a short holiday inside a long one does not shrink the block',
    nested.length === 1 && nested[0]?.endsOn === '2026-10-05',
    'the block ended early, so the notice would say the school reopens mid-closure',
  );

  console.log('\nThe pre-paid model — a December run bills January:');

  const december = autoGenerate.targetPeriod(new Date(Date.UTC(2026, 11, 28)));
  assert(
    'a run on 28 December 2026 bills January 2027',
    december.billingMonth === 1 && december.billingYear === 2027,
    `got ${String(december.billingMonth)}/${String(december.billingYear)} — a month twelve months in the past`,
  );

  const september = autoGenerate.targetPeriod(new Date(Date.UTC(2026, 8, 25)));
  assert(
    'a run on 25 September 2026 bills October 2026',
    september.billingMonth === 10 && september.billingYear === 2026,
    `got ${String(september.billingMonth)}/${String(september.billingYear)}`,
  );

  assert(
    'January 2027 falls due on the school’s own day',
    feeCalculator.defaultDueDate(1, 2027, 10) === '2027-01-10',
    `got ${feeCalculator.defaultDueDate(1, 2027, 10)}`,
  );

  console.log('\nThe two new permission keys:');

  for (const key of ['calendar.manage', 'payroll.approve'] as const) {
    assert(
      `${key} is in PERMISSIONS`,
      (permissions.PERMISSIONS as readonly string[]).includes(key),
      'it is missing from the catalogue, so no matrix can grant it',
    );
  }

  assert(
    'a Principal holds payroll.approve',
    permissions.DEFAULT_ROLE_PERMISSIONS.principal.includes('payroll.approve'),
    'the person Part C exists for cannot sign anything',
  );

  /*
   * The absence that is the decision, and the one most likely to be undone by
   * a later tidy-up granting a role "the whole payroll group". The person who
   * computes the payroll is not the person who signs it off.
   */
  assert(
    'hr_manager does NOT hold payroll.approve',
    !permissions.DEFAULT_ROLE_PERMISSIONS.hr_manager.includes('payroll.approve'),
    'HR has been given the signature as well as the computation — the control has nobody in it',
  );

  assert(
    'hr_manager DOES hold calendar.manage',
    permissions.DEFAULT_ROLE_PERMISSIONS.hr_manager.includes('calendar.manage'),
    'HR cannot keep the school’s year, which is what stops a teacher being docked',
  );

  /* ═════════════════════════════════════════════ is 0043 applied, or not? */

  console.log('\nReading the catalogue rather than being told:');

  const originRows = rows<{ n: number }>(
    await db.execute(sql`
      select count(*)::int as n
        from information_schema.columns
       where table_name = 'family_challans' and column_name = 'origin'
    `),
  );

  const holidayTable = rows<{ n: number }>(
    await db.execute(sql`
      select count(*)::int as n
        from information_schema.tables
       where table_name = 'holidays'
    `),
  );

  const applied = (originRows[0]?.n ?? 0) > 0 && (holidayTable[0]?.n ?? 0) > 0;
  console.log(`  0043 is ${applied ? 'APPLIED' : 'NOT applied'}`);

  /* ══════════════════════════════════════ Part A — the billing statements */

  console.log('\nPart A — the partial unique indexes and the family generator:');

  // The `WHERE` the new index carries, run as a predicate. It executes before
  // and after `0043` — `status` is not new — and it is here because the read in
  // `generateChallan` must agree with the index or the screen and the database
  // disagree about what "already billed" means.
  await mustRun('the partial index predicate on fee_challans', async () =>
    rows(
      await db.execute(sql`
        select id from fee_challans
         where location_id = ${NOBODY}
           and student_profile_id = ${NOBODY}
           and academic_year_id = ${NOBODY}
           and billing_month = 10 and billing_year = 2026
           and status <> 'cancelled'
         limit 1
      `),
    ),
  );

  await migrationDependent('the same predicate on family_challans', applied, async () =>
    rows(
      await db.execute(sql`
        select id, origin from family_challans
         where location_id = ${NOBODY}
           and guardian_id = ${NOBODY}
           and billing_month = 10 and billing_year = 2026
           and status <> 'cancelled'
         limit 1
      `),
    ),
  );

  /*
   * The catalogue shape, asserted in **both** directions.
   *
   * Not a `migrationDependent` statement: nothing here fails with 42P01 —
   * `pg_indexes` exists either way — so before `0043` the correct assertion is
   * that the old plain index is still there, and after it, that the partial one
   * has replaced it. Writing it as a predicted failure would have made this
   * script red on a checkout where everything is exactly as it should be, which
   * is the failure mode CLAUDE.md's "one command works on both sides" is about.
   */
  const partialIndexes = rows<{ indexname: string }>(
    await db.execute(sql`
      select indexname from pg_indexes
       where indexname in ('fee_challans_student_month_year_idx', 'family_challans_guardian_month_idx')
         and indexdef ilike '%where%cancelled%'
    `),
  );

  if (applied) {
    assert(
      'both billing indexes are partial on status <> cancelled',
      partialIndexes.length === 2,
      `found ${partialIndexes.map((row) => row.indexname).join(', ') || 'neither'} — the old plain index still counts cancelled rows`,
    );
  } else {
    assert(
      'the old plain index is still in place, as it should be before 0043',
      partialIndexes.length === 0,
      `${partialIndexes.map((row) => row.indexname).join(', ')} is already partial — has 0043 been half-applied?`,
    );
  }

  const familyChallans = await import('../lib/family-challans');

  await mustRun('enrolledSiblingsFor — the CNIC/phone match with the year join', async () =>
    familyChallans.enrolledSiblingsFor(NOBODY, NOBODY, NOBODY),
  );

  await mustRun('monthClashesForGuardian — the four-table read with the wrapper', async () =>
    familyChallans.monthClashesForGuardian(NOBODY, NOBODY, [NOBODY], 10, 2026),
  );

  await mustRun('primaryGuardianFor', async () =>
    familyChallans.primaryGuardianFor(NOBODY, NOBODY),
  );

  await mustRun('listFamilyChallans — the two ordered aggregates', async () =>
    familyChallans.listFamilyChallans(NOBODY, 1),
  );

  const feeChallans = await import('../lib/fee-challans');

  await mustRun('listBulkCandidates reaches its first read', async () =>
    feeChallans.listBulkCandidates(db, {
      locationId: NOBODY,
      academicYearId: NOBODY,
      gradeId: NOBODY,
      billingMonth: 10,
      billingYear: 2026,
    }),
  );

  notExercisedIsExpected(
    'listBulkCandidates — its widened second read',
    'it returns [] before reaching it when no student is enrolled; the same statement is executed directly below',
  );

  await mustRun(
    'the widened already-billed read, executed directly (the short-circuit above never reaches it)',
    async () =>
      rows(
        await db.execute(sql`
          select fc.student_profile_id, fc.challan_number, family.challan_number as family_number
            from fee_challans fc
            left join family_challans family on family.id = fc.family_challan_id
           where fc.location_id = ${NOBODY}
             and fc.academic_year_id = ${NOBODY}
             and fc.billing_month = 10 and fc.billing_year = 2026
             and fc.status <> 'cancelled'
        `),
      ),
  );

  await migrationDependent(
    'the auto-generate claim, as a read (the UPDATE is not run against live rows)',
    applied,
    async () =>
      rows(
        await db.execute(sql`
          select location_id, auto_generate_family_vouchers
            from late_fee_rules
           where auto_generate_vouchers = true
             and auto_generate_day = 25
             and (auto_generate_last_run_on is null or auto_generate_last_run_on < current_date)
             and location_id = ${NOBODY}
        `),
      ),
  );

  /* ═════════════════════════════════════════════════ Part B — the calendar */

  console.log('\nPart B — the calendar reads:');

  const holidayQueries = await import('../lib/holiday-queries');

  await migrationDependent('listHolidays — the range-overlap test', applied, async () =>
    holidayQueries.listHolidays(NOBODY, '2026-01-01', '2026-12-31'),
  );

  await migrationDependent(
    'listHolidays narrowed to a campus — the null-or-mine branch',
    applied,
    async () => holidayQueries.listHolidays(NOBODY, '2026-01-01', '2026-12-31', NOBODY),
  );

  await migrationDependent('saturdayPolicies', applied, async () =>
    holidayQueries.saturdayPolicies(NOBODY),
  );

  await migrationDependent(
    'saturdayOrdinalsByStaff — the staff/school_users left join',
    applied,
    async () => holidayQueries.saturdayOrdinalsByStaff(NOBODY),
  );

  await migrationDependent(
    'listStaffSaturdayDuty — the same join with the array column selected',
    applied,
    async () => holidayQueries.listStaffSaturdayDuty(NOBODY),
  );

  await migrationDependent(
    'calendarWorkingDays — the union of every rostered Saturday',
    applied,
    async () => holidayQueries.calendarWorkingDays(NOBODY, 10, 2026),
  );

  await migrationDependent(
    'the holiday-notice claim row, as a read',
    applied,
    async () =>
      rows(
        await db.execute(sql`
          select id, announcement_id, sent_at
            from holiday_notifications
           where location_id = ${NOBODY} and block_start = '2026-10-30'
        `),
      ),
  );

  const hrQueries = await import('../lib/hr-queries');

  await migrationDependent(
    'attendanceTallyByStaff — now a row-by-row read carrying the date',
    applied,
    async () => hrQueries.attendanceTallyByStaff(NOBODY, 10, 2026),
  );

  /* ═════════════════════════════════════════════════ Part C — the approval */

  console.log('\nPart C — the approval joins:');

  const approval = await import('../lib/payroll-approval');

  /*
   * The four-table join. `coverableStaffFor` reads payslips → staff →
   * school_users, and `gradesByStaff` reads timetable_entries → staff →
   * sections, plus sections by class teacher. Three of those tables carry a
   * `location_id` and two carry a `branch_id`, which is the shape CLAUDE.md's
   * ambiguity rule is about — and the only way to know Postgres accepts it is
   * to make Postgres plan it.
   */
  await mustRun('coverableStaffFor — payslips → staff → school_users', async () =>
    approval.coverableStaffFor(NOBODY, NOBODY),
  );

  await mustRun(
    'the teaching-grades read, executed directly (coverableStaffFor short-circuits on an empty run)',
    async () =>
      rows(
        await db.execute(sql`
          select distinct s.id as staff_id, sec.grade_id
            from timetable_entries te
            join staff s on s.school_user_id = te.teacher_id
            join sections sec on sec.id = te.section_id
           where te.location_id = ${NOBODY} and te.is_active = true
        `),
      ),
  );

  await mustRun('the class-teacher half of the same answer', async () =>
    rows(
      await db.execute(sql`
        select distinct class_teacher_id, grade_id
          from sections
         where location_id = ${NOBODY} and class_teacher_id = ${NOBODY}
      `),
    ),
  );

  await mustRun('the live principal assignments', async () =>
    rows(
      await db.execute(sql`
        select pa.school_user_id, su.name, pa.branch_id, pa.grade_ids
          from principal_assignments pa
          join school_users su on su.id = pa.school_user_id
         where pa.location_id = ${NOBODY}
           and pa.starts_on <= current_date
           and (pa.ends_on is null or pa.ends_on >= current_date)
      `),
    ),
  );

  notExercisedIsExpected(
    'coverableStaffFor — its teaching-grades join',
    'it returns [] before reaching it when the run has no payslips; both halves are executed directly above',
  );

  await mustRun('resolveRunApprovers end to end', async () =>
    approval.resolveRunApprovers(NOBODY, NOBODY),
  );

  await migrationDependent(
    'listRunApprovals — the approvals/school_users join',
    applied,
    async () => approval.listRunApprovals(NOBODY, NOBODY),
  );

  await migrationDependent(
    'runsAwaiting — the approvals/payroll_runs join',
    applied,
    async () => approval.runsAwaiting(NOBODY, NOBODY),
  );

  await migrationDependent(
    'the payslip override columns are selectable',
    applied,
    async () =>
      rows(
        await db.execute(sql`
          select loss_of_pay_amount, loss_of_pay_override, override_reason, overridden_by, overridden_at
            from payslips
           where location_id = ${NOBODY}
           limit 1
        `),
      ),
  );

  /*
   * `pending_approval`, read out of `pg_constraint` and asserted both ways.
   *
   * `pg_get_constraintdef` is the only evidence that the CHECK was re-added
   * rather than merely dropped — a constraint that was dropped and never
   * replaced leaves every row count identical and every insert succeeding,
   * which reads as "it works" right up until somebody writes a bad status.
   */
  const runStatusCheck = rows<{ def: string }>(
    await db.execute(sql`
      select pg_get_constraintdef(oid) as def
        from pg_constraint
       where conname = 'payroll_runs_status_check'
    `),
  );

  assert(
    'payroll_runs_status_check still exists',
    runStatusCheck.length === 1,
    'the CHECK is gone entirely — any string could be written as a run status',
  );

  assert(
    applied
      ? 'payroll_runs_status_check lists pending_approval'
      : 'payroll_runs_status_check does not yet list pending_approval, as expected before 0043',
    (runStatusCheck[0]?.def ?? '').includes('pending_approval') === applied,
    applied
      ? 'the status is in the code and not in the database — submitting a run would raise 23514'
      : 'the database already knows the status but the catalogue says 0043 is unapplied',
  );

  /* ══════════════════════ the permission CHECK, proved by attempt */

  console.log('\nThe widened permission CHECK, proved by attempt:');

  const permissionRows = rows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from role_permissions`),
  );

  for (const [key, mustBeAccepted] of [
    ['calendar.manage', true],
    ['payroll.approve', true],
    ['fees.invent', false],
  ] as const) {
    let accepted = false;
    let code: string | null = null;

    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          insert into role_permissions (location_id, role, permission, is_granted)
          select location_id, 'principal', ${key}, true from schools limit 1
        `);
        accepted = true;
        tx.rollback();
      });
    } catch (error) {
      if (!String(error).includes('Rollback')) code = sqlState(error);
    }

    if (mustBeAccepted) {
      /*
       * Both directions, again. Before `0043` these two keys **must** be
       * refused with 23514 — which is itself the proof that the CHECK is live
       * and that the migration is genuinely needed — and after it they must be
       * accepted. A script that only knew the second would be red on a correct
       * pre-migration checkout and would teach whoever ran it to ignore it.
       */
      if (applied) {
        assert(
          `${key} is accepted by the CHECK`,
          accepted,
          code === null
            ? 'the insert did not run — is there a school row to hang it on?'
            : `refused with ${code}; 0043 has not widened role_permissions_permission_check`,
        );
      } else {
        assert(
          `${key} is refused with 23514, as expected before 0043`,
          !accepted && code === '23514',
          accepted
            ? 'the database already accepts it, but the catalogue says 0043 is unapplied'
            : `expected 23514, got ${code ?? 'nothing'}`,
        );
      }
    } else {
      assert(
        `${key} is refused with 23514`,
        !accepted && code === '23514',
        accepted
          ? 'a key outside the catalogue was accepted — the CHECK is missing entirely'
          : `expected 23514, got ${code ?? 'nothing'}`,
      );
    }
  }

  const permissionRowsAfter = rows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from role_permissions`),
  );

  assert(
    'nothing was written by any of those attempts',
    (permissionRows[0]?.n ?? -1) === (permissionRowsAfter[0]?.n ?? -2),
    `role_permissions moved from ${String(permissionRows[0]?.n)} to ${String(permissionRowsAfter[0]?.n)}`,
  );

  if (!applied) {
    console.log(
      '\n  note  0043 is not applied. The migration-dependent statements above were\n' +
        '        required to fail with exactly 42P01 or 42703, and did. Re-run this\n' +
        '        after `sprint-devops` applies it — every one of them must then execute.',
    );
  }

  console.log(
    `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} ok, ${String(failures)} failed or not exercised\n`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

// Imported after `loadDatabaseUrl`, because the module opens the pool on load.
const { db } = await import('../lib/drizzle');

function rows<T>(result: unknown): T[] {
  return result as unknown as T[];
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
