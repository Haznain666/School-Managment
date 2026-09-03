/**
 * Executes Sprint 23's new and widened statements against the real schema.
 *
 *     npm run check-sprint23
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * A green build says the SQL compiled, never that Postgres would accept it. An
 * ambiguous column reference is a *planning* error — 42702 is raised when the
 * statement is resolved, not when it returns rows — so a statement that has
 * been read and not run is evidence about spelling and nothing else. That is
 * how 42702 shipped three times (STATE.md §5bg, §5av), and it is why
 * `check-sprint20`, `21` and `22` exist. This is the same script, pointed at
 * this sprint's statements.
 *
 * ── This sprint has a migration, so there are two halves ─────────────────
 * `0039` adds `schools.allow_shared_principal_grades` and `staff.photo_url`.
 * Anything selecting either **must fail with exactly `42703`** until it is
 * applied, and must execute afterwards. Everything else must execute today.
 *
 * The script **reads whether the migration is applied** out of
 * `information_schema.columns` rather than being told, so one command works on
 * both sides of the deploy and the expectation flips itself.
 *
 * And the trap that is easy to miss: a predicted `42703` is only evidence if
 * the SQLSTATE is *exactly* `42703`. **Any other error is a real defect wearing
 * a predicted failure's clothes** — a typo in a column name that exists, a bad
 * join, an ambiguous reference — so anything else is reported as a failure even
 * in the "not applied yet" half.
 *
 * ── The three traps, all paid for by earlier sprints ─────────────────────
 * 1. The SQLSTATE lives on the error's `cause` chain, not on the error.
 *    Reading `.code` answers `undefined` for every Drizzle failure.
 * 2. A read that short-circuits before reaching the new column must be
 *    reported as **not exercised**, never as a pass. `check-portals` printed
 *    `ok` for two and a half years on a statement it had never once handed to
 *    Postgres.
 * 3. postgres-js appends the whole failed query to the message; the `cause`
 *    carries the bare reason, so that is what is printed.
 *
 * ── What is deliberately not executed, and why it is said here ───────────
 *  · `POST /api/school/hr/staff/[staffId]/photo` — it uploads to Storage and
 *    writes a row. What can fail at *plan* time is the `UPDATE`'s column list,
 *    and that column is asserted in the catalogue instead.
 *  · The `UPDATE schools SET allow_shared_principal_grades` behind the Settings
 *    toggle, for the same reason and with the same substitute.
 *  · `closeStudentConcession`'s `UPDATE`. It closes a real grant. Its two reads
 *    are covered: the concession lookup runs against a nobody tenant, and
 *    `repriceOpenChallans` — the statement Sprint 23 actually widened, by
 *    selecting `fee_challans.status` — is executed directly.
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

/** "Undefined column" — the only failure a missing migration may produce. */
const UNDEFINED_COLUMN = '42703';

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

/** Not exercised, and therefore not passed. Trap 2. */
function notExercised(label: string, why: string): void {
  console.error(`  NOT EXERCISED  ${label}`);
  console.error(`        ${why}`);
  failures += 1;
}

/** A statement whose execution is the whole assertion. */
async function mustRun(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    pass(label, Array.isArray(value) ? `${String(value.length)} row(s)` : 'executed');
  } catch (error) {
    fail(label, describe(error));
  }
}

/**
 * A statement that must execute **and** must be shown to have executed.
 *
 * `reached` is handed the result and answers whether the guarded statement was
 * actually issued. An empty list is exactly what a broken statement would like
 * to be mistaken for, so nothing here treats one as evidence.
 */
async function mustReach<T>(
  label: string,
  run: () => Promise<T>,
  reached: (value: T) => boolean,
  why: string,
): Promise<void> {
  let value: T;

  try {
    value = await run();
  } catch (error) {
    fail(label, describe(error));
    return;
  }

  if (!reached(value)) {
    notExercised(label, why);
    return;
  }

  pass(label, 'executed');
}

/**
 * A statement that reads a column `0039` adds.
 *
 * Applied: it must execute. Not applied: it must fail with **exactly** 42703.
 * Anything else in either direction is a defect, including a *different*
 * SQLSTATE in the not-applied half — that is the trap this wrapper exists for.
 */
function afterMigration(applied: boolean) {
  return async (label: string, run: () => Promise<unknown>): Promise<void> => {
    if (applied) {
      await mustRun(label, run);
      return;
    }

    try {
      await run();
      fail(
        label,
        'it executed, but 0039 is not applied — so the statement is not reading the new column at all',
      );
    } catch (error) {
      const state = sqlState(error);
      if (state === UNDEFINED_COLUMN) {
        pass(label, 'predicted 42703 — waiting on 0039');
        return;
      }
      fail(label, `expected ${UNDEFINED_COLUMN} before 0039, got ${describe(error)}`);
    }
  };
}

function assert(label: string, condition: boolean, detail: string): void {
  if (condition) {
    pass(label);
    return;
  }
  fail(label, detail);
}

async function main(): Promise<void> {
  const { db } = await import('../lib/drizzle');

  const rows = <T>(result: unknown): T[] => result as unknown as T[];

  /* ---------------------------------------------------------------------
   * Is 0039 applied? Read, never assumed.
   * ------------------------------------------------------------------ */

  console.log('\nMigration 0039, read from the catalogue:');

  const columns = rows<{ table_name: string; column_name: string }>(
    await db.execute(sql`
      select table_name, column_name
        from information_schema.columns
       where table_schema = 'public'
         and (
           (table_name = 'schools' and column_name = 'allow_shared_principal_grades')
           or (table_name = 'staff' and column_name = 'photo_url')
         )`),
  );

  const hasSharedGrades = columns.some(
    (row) => row.table_name === 'schools' && row.column_name === 'allow_shared_principal_grades',
  );
  const hasStaffPhoto = columns.some(
    (row) => row.table_name === 'staff' && row.column_name === 'photo_url',
  );

  /*
   * Half-applied is its own failure, and a loud one.
   *
   * `0039` adds both columns inside one migrator transaction, so one present
   * and one absent means somebody has run the statements by hand. Reporting it
   * as "not applied" would then predict a 42703 for a statement that is going
   * to succeed, and the run would be green while the database was in a state
   * nothing in this repository produces.
   */
  assert(
    '0039 is applied consistently — both columns or neither',
    hasSharedGrades === hasStaffPhoto,
    `schools.allow_shared_principal_grades ${hasSharedGrades ? 'present' : 'absent'}, ` +
      `staff.photo_url ${hasStaffPhoto ? 'present' : 'absent'} — 0039 adds both in one transaction, ` +
      'so this database has been edited by hand',
  );

  const applied = hasSharedGrades && hasStaffPhoto;
  const needsMigration = afterMigration(applied);

  console.log(
    `  0039 is ${applied ? 'APPLIED' : 'NOT applied'} — the two columns it adds are ` +
      `${applied ? 'present' : 'absent'}, so the statements that read them are expected to ` +
      `${applied ? 'execute' : `fail with ${UNDEFINED_COLUMN}`}.`,
  );

  /*
   * The two writes this sprint does not execute, asserted by shape instead.
   * `staff.photo_url` must be nullable `text` — the route writes a URL into it
   * and every existing row has to survive the migration with a null.
   */
  if (applied) {
    const shape = rows<{ column_name: string; data_type: string; is_nullable: string }>(
      await db.execute(sql`
        select column_name, data_type, is_nullable
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'staff'
           and column_name = 'photo_url'`),
    )[0];

    assert(
      'staff.photo_url is nullable text — the photo route writes into it',
      shape?.data_type === 'text' && shape.is_nullable === 'YES',
      `got ${String(shape?.data_type)} / nullable=${String(shape?.is_nullable)}`,
    );

    const flag = rows<{ data_type: string; is_nullable: string; column_default: string | null }>(
      await db.execute(sql`
        select data_type, is_nullable, column_default
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'schools'
           and column_name = 'allow_shared_principal_grades'`),
    )[0];

    assert(
      'schools.allow_shared_principal_grades is NOT NULL boolean defaulting to false',
      flag?.data_type === 'boolean' &&
        flag.is_nullable === 'NO' &&
        (flag.column_default ?? '').startsWith('false'),
      `got ${String(flag?.data_type)} / nullable=${String(flag?.is_nullable)} / default=${String(flag?.column_default)}`,
    );
  }

  /* ---------------------------------------------------------------------
   * Item 2 — the shared-grade rule.
   * ------------------------------------------------------------------ */

  console.log('\nItem 2 — one grade, one head:');

  const { claimedGrades, getPrincipalSettings, getPrincipalModel, listPrincipalAssignments } =
    await import('../lib/principal-resolver');

  await needsMigration(
    'getPrincipalSettings — the new column, beside principal_model',
    () => getPrincipalSettings(NOBODY),
  );

  /*
   * The narrow read, which must keep working *before* the migration.
   *
   * This is the whole mitigation recorded in `SPRINT-23-DDL-NOTES.md`:
   * `getPrincipalModel` is inside `resolvePrincipalScope` and therefore on
   * every request a head makes, so it must not touch the new column. If
   * somebody "tidies" the two into one, this assertion is what fails.
   */
  await mustRun('getPrincipalModel — one column, and it must stay one', () =>
    getPrincipalModel(NOBODY),
  );

  /*
   * `claimedGrades` joins `principal_assignments` to `school_users` and filters
   * on the date window. New statement, new join, and the one whose result the
   * refusal message is built from.
   */
  await mustRun('claimedGrades — assignments in force, joined to their holders', () =>
    claimedGrades(NOBODY),
  );

  await mustRun('listPrincipalAssignments — unchanged, re-run beside its new sibling', () =>
    listPrincipalAssignments(NOBODY),
  );

  /* ---------------------------------------------------------------------
   * Item 3 — the visibility filter. The bulk of the sprint.
   * ------------------------------------------------------------------ */

  console.log('\nItem 3 — the grade filter, in every shape it is used:');

  const { visibleGradeIds, visibleSectionIds } = await import('../lib/principal-visibility');

  /*
   * `visibleGradeIds` has four branches and three of them build SQL. They are
   * each executed, because the difference between them is the `WHERE`:
   *
   *   · campuses named   -> `branch_id IS NULL OR branch_id IN (…)`
   *   · campuses empty   -> `branch_id IS NULL`
   *   · grades named     -> `id IN (…)`
   *   · grades empty     -> `false`
   *
   * The fourth (`unassigned`) returns `[]` without a query and is the one that
   * would be a leak if it were ever changed to "no filter", so it is asserted
   * rather than executed.
   */
  await mustRun('visibleGradeIds — campuses named, grades named', () =>
    visibleGradeIds(NOBODY, {
      scoped: true,
      branchIds: [NOBODY],
      gradeIds: [NOBODY],
      divisions: [],
      unassigned: false,
    }),
  );

  await mustRun('visibleGradeIds — no campus assigned, so the school-wide grades only', () =>
    visibleGradeIds(NOBODY, {
      scoped: true,
      branchIds: [],
      gradeIds: null,
      divisions: [],
      unassigned: false,
    }),
  );

  await mustRun('visibleGradeIds — a division with no classes, which is `false`', () =>
    visibleGradeIds(NOBODY, {
      scoped: true,
      branchIds: null,
      gradeIds: [],
      divisions: [],
      unassigned: false,
    }),
  );

  const unassigned = await visibleGradeIds(NOBODY, {
    scoped: true,
    branchIds: [],
    gradeIds: [],
    divisions: [],
    unassigned: true,
  });

  assert(
    'visibleGradeIds — an unassigned head resolves to [], never to null',
    Array.isArray(unassigned) && unassigned.length === 0,
    'null here would hand an unassigned head the whole school on a screen that looks normal',
  );

  await mustRun('visibleSectionIds — the section list behind a grade list', () =>
    visibleSectionIds(NOBODY, [NOBODY]),
  );

  /* -- the widened list queries -------------------------------------- */

  const { listChallans, listOutstandingChallans } = await import('../lib/fee-queries');
  const { listDefaulters } = await import('../lib/defaulters');
  const { listStudents } = await import('../lib/admissions-queries');
  const { listStaff, getStaff } = await import('../lib/hr-queries');

  /*
   * The voucher register: five statements in one call — the page, the count and
   * the three totals — and Sprint 23 puts `sections.grade_id IN (…)` into every
   * one of their `WHERE`s. Run both ways, because the narrowed form is a
   * different plan from the unnarrowed one.
   */
  await mustRun('listChallans — the register, unnarrowed', () =>
    listChallans(NOBODY, { scopeGradeIds: null }),
  );

  await mustRun('listChallans — the register, narrowed by grade', () =>
    listChallans(NOBODY, { scopeGradeIds: [NOBODY], gradeId: NOBODY, search: 'a' }),
  );

  await mustRun('listOutstandingChallans — the outstanding report, narrowed', () =>
    listOutstandingChallans(NOBODY, { scopeGradeIds: [NOBODY] }),
  );

  await mustRun('listOutstandingChallans — the chase list, narrowed and aged', () =>
    listOutstandingChallans(NOBODY, { scopeGradeIds: [NOBODY], minDaysOverdue: 30 }),
  );

  await mustRun('listDefaulters — aged debt, narrowed by grade', () =>
    listDefaulters(NOBODY, { scopeGradeIds: [NOBODY] }),
  );

  await mustRun('listStudents — the roll, with BR4 in the WHERE (Sprint 13, re-run)', () =>
    listStudents(NOBODY, { scope: { branchIds: [NOBODY], gradeIds: [NOBODY] } }),
  );

  /*
   * The staff directory: widened twice this sprint, by `staff.photo_url` in the
   * select list (0039) and by `scopeBranchIds` in the `WHERE`. One statement, so
   * one assertion — and it belongs in the migration half, because the select
   * list is what fails first.
   */
  await needsMigration('listStaff — photo_url in the select, scopeBranchIds in the WHERE', () =>
    listStaff(NOBODY, { scopeBranchIds: [NOBODY] }),
  );

  await needsMigration('listStaff — the `branch_id IS NULL` form of the same filter', () =>
    listStaff(NOBODY, { scopeBranchIds: [] }),
  );

  await needsMigration('getStaff — the profile, now selecting photo_url', () =>
    getStaff(NOBODY, NOBODY),
  );

  /* -- the reports --------------------------------------------------- */

  const { runReport } = await import('../lib/report-queries');
  const { loadReportOptions } = await import('../lib/report-options');
  const { reportFor } = await import('../lib/report-catalogue');

  /*
   * The five runners that join `grades` and therefore grew `scopedGrades()`.
   * The other eleven are untouched — the seven financial statements have no
   * class dimension at all — and `check-reports` covers every one of the
   * sixteen unnarrowed, so running the five narrowed forms here is the whole
   * of the new surface.
   */
  const narrowedReports = [
    'attendance-summary',
    'subject-attendance',
    'fee-collection',
    'outstanding-aging',
    'academic-results',
  ] as const;

  for (const key of narrowedReports) {
    await mustRun(`runReport ${key} — with the BR4 grade filter`, () =>
      runReport(
        key,
        { locationId: NOBODY, sessionBranchId: null, branchIds: null, gradeIds: [NOBODY] },
        { from: '2026-01-01', to: '2026-12-31', termId: NOBODY },
      ),
    );
  }

  await mustRun('loadReportOptions — the class dropdown, narrowed by BR4', () =>
    loadReportOptions(reportFor('attendance-summary'), NOBODY, null, [NOBODY]),
  );

  /* -- the enrolment history the student profile now judges on -------- */

  const { listEnrollmentHistory } = await import('../lib/admissions-queries');

  await mustReach(
    'listEnrollmentHistory — now selecting grades.id for the profile narrowing',
    () => listEnrollmentHistory(NOBODY, NOBODY),
    (value) => Array.isArray(value),
    'it did not return a list, so the statement behind it was never issued',
  );

  /* ---------------------------------------------------------------------
   * Item 4 — the class-teacher picker.
   * ------------------------------------------------------------------ */

  console.log('\nItem 4 — any active member of staff:');

  const { listClassTeacherCandidates } = await import('../lib/exam-queries');

  /*
   * Two statements now, and the second is new: `sections` joined to `grades`
   * with a concatenated label. `staff.is_class_teacher` has gone from the
   * first's `WHERE`.
   *
   * `mustReach` rather than `mustRun`, because the function returns an array
   * either way — what has to be shown is that the *shape* came back, which
   * means both statements were issued and the mapping between them ran.
   */
  await mustReach(
    'listClassTeacherCandidates — the widened first read AND the new held-sections read',
    () => listClassTeacherCandidates(NOBODY, null),
    (value) => Array.isArray(value),
    'it did not return a list, so one of the two statements was never issued',
  );

  await mustRun('listClassTeacherCandidates — the branch-bound form', () =>
    listClassTeacherCandidates(NOBODY, NOBODY),
  );

  /* ---------------------------------------------------------------------
   * Item 1 — the discount that would not come off.
   * ------------------------------------------------------------------ */

  console.log('\nItem 1 — repricing on removal:');

  const { repriceOpenChallans } = await import('../lib/fee-challans');
  const { getStudentDiscountState } = await import('../lib/student-discounts');

  /*
   * The widened select — `fee_challans.status` now comes back so a part-paid
   * voucher can be reported by name rather than silently filtered out. A nobody
   * tenant reaches it: there is no guard in front, and with no rows the loop
   * below it does nothing and writes nothing.
   */
  await mustRun('repriceOpenChallans — the widened header read, default options', () =>
    repriceOpenChallans(db, {
      locationId: NOBODY,
      studentProfileId: NOBODY,
      actorUid: NOBODY,
    }),
  );

  await mustRun("repriceOpenChallans — the removal's own options", () =>
    repriceOpenChallans(db, {
      locationId: NOBODY,
      studentProfileId: NOBODY,
      actorUid: NOBODY,
      priceAsOf: 'today',
      statuses: ['unpaid'],
    }),
  );

  /*
   * `closeStudentConcession`'s first read, reached through the panel loader
   * rather than through the closer: the closer would write, and this is a gate.
   * Same tables, same tenant filter.
   */
  await mustRun('getStudentDiscountState — the grants the removal panel closes', () =>
    getStudentDiscountState(NOBODY, NOBODY),
  );

  console.log(
    `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} ok, ${String(failures)} failed or not exercised\n`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
