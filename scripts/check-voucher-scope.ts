/**
 * The fee module's campus boundary — the rules, then the leak itself, attempted.
 *
 *     npm run check-voucher-scope
 *
 * ── The defect this exists about ─────────────────────────────────────────
 * Sprint 33c's QA round 1 recorded it as **F5**. Signed in as Imran Qureshi,
 * Principal of *Askari Main Campus*: `GET /api/school/students` returned 343
 * students, every one of them Main, and `ASST-2026-0006` was not among them —
 * yet `/dashboard/fees/challans/181de701-…` rendered that student's voucher in
 * full, Shahmir Awan of *Askari Junior Campus*, print sheet included, headed
 * with Junior's address and carrying Junior's bank details.
 *
 * The guard was on the student **list** and never on the voucher **record**.
 * `git show 8c0bc0c:` proves it was byte-identical for as long as the page had
 * existed, so it is a pre-existing leak in the fee module rather than anything
 * Part C did to that page's print controls.
 *
 * ── Part one needs no database ───────────────────────────────────────────
 * The rules it turns on:
 *
 *   · **R1.** `getChallanDetail`'s campus parameter is **required and has no
 *     default**. An optional one is how this went unnoticed: every call site
 *     compiles, every screen works, and nothing says which are scoped.
 *   · **R2.** Every school-side caller passes `effectiveBranchIds(…)` from
 *     `resolveBranchScope`, and the parent portal — which has no campus —
 *     passes `null` and is the *only* thing allowed to.
 *   · **R3.** The predicate is `ownedBy`, never `sharedOrOwnedBy`. On `grades`
 *     a null `branch_id` is a row that predates the column, not a shared row,
 *     and the two give opposite answers on exactly that value.
 *   · **R4.** The refusal reuses the not-found path — **404**, never 403. "You
 *     may not see this voucher" confirms a voucher with that id exists at this
 *     school, which is the one fact the boundary withholds.
 *   · **R5.** One scope mechanism per handler. The register carries the campus
 *     *as well as* `visibleScopeFor`, because that one short-circuits to
 *     UNSCOPED for every role except `principal` — the F2/F3 shape.
 *
 * ── Part two executes every widened statement ────────────────────────────
 * Printing `toSQL()` proves the names; only a server proves the statement
 * (CLAUDE.md). An ambiguous column reference is a *planning* error, raised
 * when Postgres resolves the query rather than when it returns rows, so a
 * statement that has been read and not run is evidence about spelling and
 * nothing else. Every read here gained a predicate and one of them gained
 * three joins, so every one is run against the real schema with a tenant id
 * that matches no row: nothing is read, nothing is written, and Postgres still
 * parses, resolves every column and plans.
 *
 * The SQLSTATE lives on the error's `cause` and not on the error. Reading
 * `.code` reports every failure as unpredicted — the trap this pattern has
 * paid for once already.
 *
 * ── Part three is the only part that proves anything ─────────────────────
 * **A check that reads a guard proves nothing.** Parts one and two say the
 * rule is written down and the statements plan; neither says the voucher is
 * actually refused. So part three attempts the leak against real rows: it
 * finds a tenant with two campuses that both have vouchers, takes one voucher
 * from each, and requires that
 *
 *   · reading it scoped to **its own** campus returns the row, and
 *   · reading it scoped to **the other** campus returns **null**, and
 *   · reading it with `null` — every campus — still returns the row, so a
 *     school-wide reader is provably unchanged.
 *
 * Both directions matter. A guard that refuses everything passes the first
 * assertion of any test that only checks the leak is closed, and it would
 * break every school in the product.
 *
 * If no tenant has two campuses carrying vouchers, that is reported as **not
 * exercised** and fails the run — a leak test that quietly skips is how a
 * broken statement hides behind an early return.
 *
 * ── No emoji, and that is not a style choice ─────────────────────────────
 * This file is edited by tooling that has already truncated it to zero bytes
 * once, on an astral-plane character that came back from a read as an unpaired
 * surrogate. Markers here are ASCII.
 *
 * Reads `DATABASE_URL` from the main checkout's `.env.local`, because a
 * worktree has no env of its own.
 */

import { readFileSync } from 'node:fs';

import { and, eq, isNotNull, sql } from 'drizzle-orm';

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

  throw new Error(
    'DATABASE_URL not found — set it, or run from a checkout with .env.local',
  );
}

/** A syntactically valid id that belongs to no tenant and no row. */
const NOBODY = '00000000-0000-0000-0000-000000000000';
const OTHER_NOBODY = '11111111-1111-1111-1111-111111111111';
const TENANT = 'no-such-tenant-voucher-scope';

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

/** The SQLSTATE lives on the error's `cause` chain, not on the error. */
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
      return (message.split('\n')[0] ?? message).slice(0, 160);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return String(error).slice(0, 160);
}

/** A statement whose execution is the whole assertion. */
async function mustRun(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    pass(
      label,
      Array.isArray(value)
        ? `${String(value.length)} row(s)`
        : value === null
          ? 'null'
          : 'executed',
    );
  } catch (error) {
    fail(label, `${sqlState(error) ?? '?'} ${reason(error)}`);
  }
}

/**
 * Source text, always LF.
 *
 * The repository is developed on Windows with `core.autocrlf=true`, so the
 * working tree is CRLF and git stores LF. A pattern anchored on `\n` therefore
 * matches in one checkout and silently matches **nothing** in another.
 */
const source = (path: string): string =>
  readFileSync(path, 'utf8').split('\r\n').join('\n');

/**
 * Comments stripped.
 *
 * Every guarded file explains in prose why the refusal is 404 and not 403, so
 * a search for the three digits over the raw text fails on the very paragraph
 * that states the rule — a check marking its own documentation as the breach.
 */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every school-side file that reads a voucher by an id it was handed. */
const SCHOOL_SIDE_CALLERS = [
  'app/(school-admin)/dashboard/fees/challans/[challanId]/page.tsx',
  'app/(school-admin)/dashboard/fees/challans/[challanId]/record-payment/page.tsx',
  'app/(school-admin)/dashboard/fees/challans/print/page.tsx',
  'app/api/school/fees/challans/[challanId]/route.ts',
  'app/api/school/fees/challans/[challanId]/payments/route.ts',
] as const;

/** The list reads that hand those ids out, and so must be narrowed with them. */
const LIST_CALLERS = [
  'app/api/school/fees/challans/route.ts',
  'app/api/school/fees/reports/outstanding/route.ts',
  'app/api/school/fees/reports/defaulters/route.ts',
  'app/api/school/fees/reminders/route.ts',
  'app/(school-admin)/dashboard/fees/defaulters/page.tsx',
] as const;

async function main(): Promise<void> {
  /* ══════════════════════════════════════════════ part one: the rules */

  const feeQueries = source('lib/fee-queries.ts');
  const branchScope = source('lib/branch-scope.ts');

  console.log('\nR1 — the campus parameter is required, and has no default:');

  assert(
    'getChallanDetail takes `branchIds: string[] | null` as a third parameter',
    /export async function getChallanDetail\(\s*locationId: string,\s*challanId: string,\s*branchIds: string\[\] \| null,\s*\): Promise<ChallanDetail \| null>/.test(
      feeQueries,
    ),
  );
  assert(
    'listChallansForReminder takes it too — the body-id door',
    /export async function listChallansForReminder\(\s*locationId: string,\s*challanIds: readonly string\[\],\s*branchIds: string\[\] \| null,/.test(
      feeQueries,
    ),
  );

  /*
   * Read out of the two signatures, not searched for across the file.
   *
   * `listFeeTypes` takes an optional `branchIds` of its own and is entitled to
   * — `fee_types.branch_id` is the *shared* kind of column, read through
   * `sharedOrOwnedBy`, and a fee head genuinely does default to every campus.
   * A file-wide search would fail on it and teach the next reader that this
   * assertion cries wolf.
   */
  const signatureOf = (name: string): string => {
    const opens = feeQueries.indexOf(`export async function ${name}(`);
    if (opens === -1) return '';
    const start = feeQueries.indexOf('(', opens);
    const ends = feeQueries.indexOf('): Promise<', start);
    return ends === -1 ? '' : feeQueries.slice(start + 1, ends);
  };

  for (const name of ['getChallanDetail', 'listChallansForReminder']) {
    const params = signatureOf(name);
    assert(
      `(!) ${name}'s campus parameter is neither optional nor defaulted`,
      params.includes('branchIds: string[] | null,') &&
        !/branchIds\?:/.test(params) &&
        !/branchIds[^,]*=/.test(params),
      'a default makes every new caller unscoped and every existing one still compile ' +
        '— which is exactly how this shipped',
    );
  }

  console.log('\nR2 — every caller answers the question, and only one answers `null`:');

  for (const path of SCHOOL_SIDE_CALLERS) {
    const text = source(path);
    assert(
      `${path} resolves the scope`,
      text.includes('resolveBranchScope') && text.includes('effectiveBranchIds'),
      'the campus must be resolved, not read off `claims.branchId` — a person granted ' +
        'two campuses may read a voucher at either',
    );
    assert(
      `(!) ${path} passes no literal null`,
      !/getChallanDetail\([^;]*,\s*null\s*\)/.test(text),
      'null is every campus, and only the parent portal is entitled to it',
    );
  }

  const parentPage = source('app/(parent)/parent/fees/page.tsx');
  assert(
    'the parent portal passes null, and says why',
    /getChallanDetail\(locationId, requestedChallan, null\)/.test(parentPage) &&
      parentPage.includes('A parent belongs to no campus'),
    'a parent has no campus; what bounds that read is that the voucher is their own child\u2019s',
  );

  console.log('\nR3 — ownedBy, never sharedOrOwnedBy:');

  assert(
    'voucherCampusIn is built on ownedBy',
    /function voucherCampusIn\(branchIds: string\[\] \| null\): SQL \| undefined \{\s*const owned = ownedBy\(grades\.branchId, branchIds\);/.test(
      feeQueries,
    ),
  );
  assert(
    '(!) it never reaches for sharedOrOwnedBy on grades.branch_id',
    !/sharedOrOwnedBy\(grades\.branchId/.test(feeQueries),
    'on `grades` a null branch_id is a row that predates the column, not a shared row',
  );
  assert(
    'the null it does admit is the absent join, named as such',
    /return or\(isNull\(grades\.id\), owned\);/.test(feeQueries),
    '`grades.id` null means no placement; `grades.branch_id` is NOT NULL and cannot be ' +
      'the null in question',
  );
  assert(
    'ownedBy still returns `false` for an empty scope',
    /export function ownedBy[\s\S]{0,400}?if \(branchIds\.length === 0\) return sql`false`;/.test(
      branchScope,
    ),
    'the dangerous direction is the one where an empty list widens rather than narrows',
  );
  assert(
    'listDefaulters uses ownedBy directly — its join to grades is inner',
    /ownedBy\(grades\.branchId, filters\.scopeBranchIds \?\? null\)/.test(
      source('lib/defaulters.ts'),
    ),
  );

  console.log('\nR4 — the refusal reuses the not-found path, and never 403:');

  for (const path of SCHOOL_SIDE_CALLERS) {
    const code = withoutComments(source(path));

    /*
     * The bulk printer refuses differently, and correctly: an id outside the
     * caller's campuses comes back null from `getChallanDetail` and is dropped
     * from the batch, exactly as another tenant's id already was. There is no
     * `notFound()` to find because the run is not about one voucher.
     */
    const refuses = path.endsWith('print/page.tsx')
      ? /challans\.filter\(\(challan\) => challan !== null\)/.test(code)
      : path.endsWith('.tsx')
        ? code.includes('notFound()')
        : /apiFailure\('not_found', 'Voucher not found\.', 404\)/.test(code);

    assert(
      `${path} refuses by treating the voucher as absent`,
      refuses,
      'the campus guard must reuse the not-found path, or it becomes a second refusal ' +
        'to keep in step with the first',
    );
    assert(
      `(!) ${path} grows no 403`,
      !/\b403\b/.test(code),
      'a 403 confirms the voucher exists at this school, which is what the boundary withholds',
    );
  }

  console.log('\nR5 — one scope mechanism per handler:');

  const register = source('app/api/school/fees/challans/route.ts');
  assert(
    'the register carries the campus as well as visibleScopeFor',
    register.includes('scopeBranchIds: effectiveBranchIds(branchScope)') &&
      register.includes('scopeGradeIds: visible.gradeIds'),
    'visibleScopeFor short-circuits to UNSCOPED for every role except `principal` — ' +
      'the F2/F3 shape',
  );
  for (const path of LIST_CALLERS) {
    assert(
      `${path} narrows by campus`,
      source(path).includes('effectiveBranchIds'),
      'this list names a challanId on every row; unscoped, it is where the ids come from',
    );
  }
  assert(
    '(!) the aged-debt screen no longer reads claims.branchId',
    !/branchId: claims\.branchId/.test(
      source('app/(school-admin)/dashboard/fees/defaulters/page.tsx'),
    ),
    'a raw claim answers for one campus and always the same one — the second mechanism ' +
      '`lib/branch-scope.ts` exists to abolish',
  );

  /* ═══════════════════════════════ part two: every statement, executed */

  loadDatabaseUrl();

  const { db } = await import('../lib/drizzle');
  const {
    getChallanDetail,
    listChallans,
    listChallansForReminder,
    listOutstandingChallans,
  } = await import('../lib/fee-queries');
  const { listDefaulters } = await import('../lib/defaulters');
  const { branches, feeChallans, grades, sections, studentEnrollments } = await import(
    '../db/schema'
  );

  console.log('\nEvery widened statement, against the real schema:');

  await mustRun('getChallanDetail — every campus (the parent portal\u2019s answer)', () =>
    getChallanDetail(TENANT, NOBODY, null),
  );
  await mustRun('getChallanDetail — one campus', () =>
    getChallanDetail(TENANT, NOBODY, [NOBODY]),
  );
  await mustRun('getChallanDetail — two campuses', () =>
    getChallanDetail(TENANT, NOBODY, [NOBODY, OTHER_NOBODY]),
  );
  await mustRun('getChallanDetail — an empty scope, which is `false`', () =>
    getChallanDetail(TENANT, NOBODY, []),
  );

  await mustRun('listChallans — the register, campus and grades together', () =>
    listChallans(TENANT, { scopeBranchIds: [NOBODY], scopeGradeIds: [NOBODY] }),
  );
  await mustRun('listChallans — campus only, every grade', () =>
    listChallans(TENANT, { scopeBranchIds: [NOBODY], scopeGradeIds: null }),
  );
  await mustRun('listChallans — an empty campus scope, sorted and searched', () =>
    listChallans(TENANT, {
      scopeBranchIds: [],
      sort: 'balance',
      direction: 'asc',
      search: 'a',
    }),
  );

  await mustRun('listOutstandingChallans — the outstanding report, narrowed', () =>
    listOutstandingChallans(TENANT, {
      scopeBranchIds: [NOBODY],
      scopeGradeIds: [NOBODY],
    }),
  );
  await mustRun('listOutstandingChallans — the chase list, narrowed and aged', () =>
    listOutstandingChallans(TENANT, { scopeBranchIds: [NOBODY], minDaysOverdue: 30 }),
  );

  await mustRun('listDefaulters — aged debt, narrowed by campus', () =>
    listDefaulters(TENANT, { scopeBranchIds: [NOBODY], scopeGradeIds: [NOBODY] }),
  );

  await mustRun('listChallansForReminder — the body-id read, three new joins', () =>
    listChallansForReminder(TENANT, [NOBODY], [NOBODY]),
  );
  await mustRun('listChallansForReminder — every campus', () =>
    listChallansForReminder(TENANT, [NOBODY], null),
  );

  /* ══════════════════ part three: the leak itself, attempted on real rows */

  console.log('\nThe leak, attempted against real vouchers:');

  /*
   * One voucher per campus, for a tenant that actually has two.
   *
   * Read through the same placement chain the guard resolves the campus with,
   * so the fixture and the thing under test cannot disagree about which campus
   * a voucher belongs to. `DISTINCT ON` takes one voucher per campus.
   */
  const specimens = await db
    .selectDistinctOn([grades.branchId], {
      locationId: feeChallans.locationId,
      challanId: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      branchId: grades.branchId,
      branchName: branches.name,
    })
    .from(feeChallans)
    .innerJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, feeChallans.studentProfileId),
        eq(studentEnrollments.academicYearId, feeChallans.academicYearId),
      ),
    )
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(branches, eq(branches.id, grades.branchId))
    .where(isNotNull(grades.branchId))
    .orderBy(grades.branchId, feeChallans.id);

  // Two campuses of the *same* tenant. A cross-tenant pair proves nothing new:
  // `location_id` has always refused that.
  const byTenant = new Map<string, typeof specimens>();
  for (const row of specimens) {
    byTenant.set(row.locationId, [...(byTenant.get(row.locationId) ?? []), row]);
  }
  const pair = [...byTenant.values()].find((rows) => rows.length >= 2);

  if (pair === undefined) {
    fail(
      'a tenant with vouchers at two campuses',
      'NOT EXERCISED — no tenant in this database has vouchers at two campuses, so the ' +
        'leak was never attempted. Reported as a failure rather than skipped: a guard ' +
        'test that quietly does nothing is worse than none.',
    );
  } else {
    const [mine, theirs] = [pair[0]!, pair[1]!];
    const label = (row: typeof mine) => `${row.challanNumber} (${row.branchName})`;

    console.log(
      `  using ${label(mine)} and ${label(theirs)} at tenant ${mine.locationId}`,
    );

    const ownCampus = await getChallanDetail(mine.locationId, mine.challanId, [
      mine.branchId!,
    ]);
    assert(
      `a reader at ${mine.branchName} still opens ${mine.challanNumber}`,
      ownCampus !== null,
      'the guard refuses everything — which closes the leak and breaks every school',
    );

    const otherCampus = await getChallanDetail(mine.locationId, theirs.challanId, [
      mine.branchId!,
    ]);
    assert(
      `[LEAK] a reader at ${mine.branchName} is refused ${label(theirs)}`,
      otherCampus === null,
      'THE LEAK IS OPEN — this is F5 exactly: a campus-bound reader holding a voucher id ' +
        'gets the other campus\u2019s student, class, guardian and bank details',
    );

    const reverse = await getChallanDetail(mine.locationId, mine.challanId, [
      theirs.branchId!,
    ]);
    assert(
      `[LEAK] a reader at ${theirs.branchName} is refused ${label(mine)}`,
      reverse === null,
      'the refusal has to hold in both directions, or it is one campus being privileged',
    );

    const schoolWide = await getChallanDetail(mine.locationId, theirs.challanId, null);
    assert(
      'a school-wide reader opens either, unchanged',
      schoolWide !== null,
      '`null` must remain no filter at all, or this fix takes the fee module away from ' +
        'head office',
    );

    const emptyScope = await getChallanDetail(mine.locationId, mine.challanId, []);
    assert(
      'an empty scope reaches nothing',
      emptyScope === null,
      'an empty list must narrow to nothing, never widen to everything',
    );

    // The register has to agree with the record, or it lists ids that 404.
    const scopedRegister = await listChallans(mine.locationId, {
      scopeBranchIds: [mine.branchId!],
      limit: 100,
    });
    assert(
      `the register at ${mine.branchName} offers no voucher the page would refuse`,
      !scopedRegister.challans.some((row) => row.id === theirs.challanId),
      'a list that hands out ids the detail page 404s on is a broken screen dressed as a fix',
    );

    /*
     * The reminder door, closed here rather than in a browser.
     *
     * Driving `POST /api/school/fees/reminders` against a voucher the guard is
     * supposed to refuse would, if the guard were open, put a real fee demand
     * in a real parent's inbox and a `fee_reminders` row behind it. So this one
     * is proved by the read the route makes — which is the whole of its campus
     * guard — and nothing is sent either way.
     */
    const chaseTheirs = await listChallansForReminder(
      mine.locationId,
      [theirs.challanId],
      [mine.branchId!],
    );
    assert(
      `[LEAK] a reminder run at ${mine.branchName} cannot reach ${label(theirs)}`,
      chaseTheirs.length === 0,
      'an open door here emails another campus\u2019s parents about another campus\u2019s bills',
    );

    const chaseMine = await listChallansForReminder(
      mine.locationId,
      [mine.challanId],
      [mine.branchId!],
    );
    assert(
      `a reminder run at ${mine.branchName} still reaches its own ${mine.challanNumber}`,
      chaseMine.length === 1,
      'the chase list must keep working, or the fix has taken reminders away from the campus',
    );
  }

  /*
   * The claim the `voucherCampusIn` docblock makes, re-counted.
   *
   * Every voucher in the product resolves to a campus today, so the null the
   * predicate admits is a case that does not yet occur. If this ever comes
   * back short, somebody reads that paragraph instead of discovering it.
   */
  const counts = await db.execute(sql`
    select count(*)::int as total,
           count(*) filter (where g.branch_id is null)::int as no_campus
      from fee_challans c
      left join student_enrollments se
        on se.student_profile_id = c.student_profile_id
       and se.academic_year_id = c.academic_year_id
      left join sections s on s.id = se.section_id
      left join grades g on g.id = s.grade_id`);

  const counted = counts[0] as { total: number; no_campus: number } | undefined;
  assert(
    'every voucher in the database resolves to a campus',
    counted !== undefined && counted.no_campus === 0,
    `${String(counted?.no_campus ?? '?')} of ${String(counted?.total ?? '?')} vouchers ` +
      'resolve to no campus — they are admitted to every reader by design (they carry ' +
      'no campus\u2019s details), but read `voucherCampusIn` before assuming that is still right',
  );
  if (counted !== undefined && counted.no_campus === 0) {
    console.log(`        ${String(counted.total)} of ${String(counted.total)} placed`);
  }

  console.log(`\n${String(passes)} passed, ${String(failures)} failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
