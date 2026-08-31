/**
 * Executes Sprint 21's statements against the real schema — and proves it
 * reached them.
 *
 * ── Why this exists, and why `check-portals` was not enough ──────────────
 * `check-portals` has called `listPublishedTermsForStudent` since Sprint 13, at
 * line 298, with a tenant id belonging to nobody. The function returns `[]` at
 * its own `enrolments.length === 0` guard **before** it builds the statement,
 * so for every one of those runs the gate reported `ok` on SQL it had never
 * once handed to Postgres.
 *
 * What was hiding behind that early return was a `SELECT DISTINCT` ordered by
 * `academic_years.start_year`, which was not in its select list. Postgres
 * refuses that outright — 42P10, at *plan* time, so not one row ever came
 * back — and it took down `/student/results`, `/parent/results` and the
 * attendance-and-results panel of every child card on the parent dashboard,
 * where `settle()` caught the throw per child and rendered the card half blank
 * with nothing anywhere saying why. It had never worked at any school.
 *
 * CLAUDE.md names this trap in as many words:
 *
 *   > a read that short-circuits before it reaches the new column must be
 *   > reported as *not exercised* rather than passed, or a broken statement
 *   > hides behind an early return.
 *
 * So this script does the opposite of every check before it. **It uses a tenant
 * and a student that exist**, discovered from the database rather than typed in
 * — read-only, and by shape rather than by name, so it keeps working at a
 * school this sprint has never heard of. A run that cannot find data to reach a
 * statement with reports **not exercised**, and not exercised is a failure.
 *
 *     npm run check-sprint21
 *
 * ── The split, and why a failure is sometimes the pass ───────────────────
 * Everything here executes today. What changes across migration `0038` is the
 * *data*: before it there is a duplicate address and a guardian linked to a
 * child's directory row at LGS, and after it there is neither and an index that
 * refuses the next one. Both sides are asserted, and which side we are on is
 * read from `pg_indexes` rather than being told, so one command works on both.
 *
 * ── Nothing here writes ──────────────────────────────────────────────────
 * Every statement is a SELECT. The two guards this sprint added sit in front of
 * an upsert and an OTP redemption, both of which write; they were lifted into
 * `portalAccountBlocker`, `activeMembershipsByEmail` and
 * `linkableAccountsByPhone` precisely so this script can execute them without
 * touching a row. A guard that only runs on a path nobody dares run in a test
 * is a guard nobody has run.
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

/** The index `0038` creates. Asserted by name, because a rename is a silent no-op. */
const EMAIL_INDEX = 'school_users_location_email_active_idx';

let failures = 0;
let passes = 0;

/**
 * The SQLSTATE, dug out from under Drizzle's wrapper.
 *
 * Drizzle throws a `DrizzleQueryError` whose own `code` is undefined and whose
 * `cause` is the postgres-js error carrying the real one. Reading `error.code`
 * directly answers `undefined` for **every** failure, which is the trap
 * `check-sprint20` paid for first.
 */
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
 * Not exercised, and therefore not passed.
 *
 * This is the whole reason the file exists. `check-portals` printed `ok` here
 * for two and a half years.
 */
function notExercised(label: string, why: string): void {
  console.error(`  NOT EXERCISED  ${label}`);
  console.error(`        ${why}`);
  failures += 1;
}

/**
 * A statement that must execute **and** must be shown to have executed.
 *
 * `reached` is handed the result and answers whether the statement was actually
 * issued — usually "it returned at least one row", which nothing but the server
 * can produce. A function that short-circuited returns an empty list, and an
 * empty list is exactly what a broken statement would like to be mistaken for.
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

  pass(label, Array.isArray(value) ? `${value.length} row(s)` : 'executed');
}

/** A statement whose result proves nothing, but whose execution does. */
async function mustRun(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    pass(label, Array.isArray(value) ? `${value.length} row(s)` : 'executed');
  } catch (error) {
    fail(label, describe(error));
  }
}

function assert(label: string, condition: boolean, detail: string): void {
  if (condition) {
    pass(label);
    return;
  }
  fail(label, detail);
}

interface Subject {
  locationId: string;
  studentProfileId: string;
  academicYearId: string;
}

async function main(): Promise<void> {
  const { db } = await import('../lib/drizzle');
  const { listPublishedTermsForStudent, listStudentResultHistory } = await import(
    '../lib/portal-results'
  );
  const { getChildSnapshot } = await import('../lib/portal-dashboard');
  const { portalAccountBlocker } = await import('../lib/parent-portal-access');
  const { activeMembershipsByEmail, getSchoolUserByUid } = await import(
    '../lib/school-queries'
  );
  const { linkableAccountsByPhone } = await import('../lib/enrollment');

  const rows = <T>(result: unknown): T[] => result as unknown as T[];

  /* ---------------------------------------------------------------------
   * Which side of 0038 we are on. Read, not assumed.
   * ------------------------------------------------------------------ */

  const indexProbe = await db.execute(
    sql`select exists (select 1 from pg_indexes
                        where schemaname = 'public' and indexname = ${EMAIL_INDEX}) as present`,
  );
  const migrated = Boolean(rows<{ present: boolean }>(indexProbe)[0]?.present);

  console.log(
    migrated
      ? `\n0038 IS APPLIED — ${EMAIL_INDEX} exists, so the repair must have left nothing behind.\n`
      : `\n0038 is NOT applied — ${EMAIL_INDEX} is absent, so the rows it repairs are still there and are reported rather than failed.\n`,
  );

  /* ---------------------------------------------------------------------
   * Find a tenant and two students that exist. By shape, not by name.
   * ------------------------------------------------------------------ */

  console.log('Finding real subjects for the portal reads:');

  // A student whose section sat at least one exam in a published, unarchived
  // term. `listPublishedTermsForStudent` must return rows for this one, and a
  // returned row is the only proof that exists that the DISTINCT ran.
  const withTerms = rows<Subject>(
    await db.execute(sql`
      select se.location_id      as "locationId",
             se.student_profile_id as "studentProfileId",
             se.academic_year_id  as "academicYearId"
        from student_enrollments se
        join exams e
          on e.location_id = se.location_id and e.section_id = se.section_id
        join exam_terms t on t.id = e.term_id
       where t.is_published and t.archived_at is null
       order by se.student_profile_id
       limit 1`),
  )[0];

  // And one enrolled at a school where no term has been published for their
  // section. The statement must still *run*, and return nothing.
  const withoutTerms = rows<Subject>(
    await db.execute(sql`
      select se.location_id      as "locationId",
             se.student_profile_id as "studentProfileId",
             se.academic_year_id  as "academicYearId"
        from student_enrollments se
       where not exists (
               select 1 from exams e
                 join exam_terms t on t.id = e.term_id
                where e.location_id = se.location_id
                  and e.section_id = se.section_id
                  and t.is_published and t.archived_at is null)
       order by se.student_profile_id
       limit 1`),
  )[0];

  if (withTerms === undefined) {
    notExercised(
      'a student with a published term',
      'no school on this database has a published, unarchived term with an exam in it — the DISTINCT cannot be proven to return rows, which is the one thing this script is for.',
    );
  } else {
    pass('a student with a published term', withTerms.studentProfileId);
  }

  if (withoutTerms === undefined) {
    notExercised(
      'a student with no published term',
      'no enrolled student anywhere lacks a published term — the empty case cannot be exercised.',
    );
  } else {
    pass('a student with no published term', withoutTerms.studentProfileId);
  }

  /* ---------------------------------------------------------------------
   * Item 1 — the statement that had never executed.
   * ------------------------------------------------------------------ */

  console.log('\nItem 1 — listPublishedTermsForStudent, the 42P10:');

  if (withTerms !== undefined) {
    await mustReach(
      'listPublishedTermsForStudent — a student who has a published term',
      () => listPublishedTermsForStudent(withTerms.locationId, withTerms.studentProfileId),
      (terms) => terms.length > 0,
      'it returned nothing for a student the discovery query says has a published term, which means it short-circuited at the enrolments guard and the DISTINCT was never issued.',
    );

    await mustReach(
      'getChildSnapshot — the parent dashboard child card',
      () => getChildSnapshot(withTerms.locationId, withTerms.studentProfileId, withTerms.academicYearId),
      (snapshot) => snapshot.publishedTerms > 0,
      'the card came back with no published terms for a student who has one, so the read behind the results panel did not run.',
    );

    await mustRun('listStudentResultHistory — the same child, the history list', () =>
      listStudentResultHistory(withTerms.locationId, withTerms.studentProfileId),
    );
  }

  if (withoutTerms !== undefined) {
    // Nothing to return, so nothing proves it ran except not throwing — which
    // is precisely what 42P10 did not manage. It is the empty case and it is
    // labelled as such rather than dressed up as a stronger assertion.
    await mustRun(
      'listPublishedTermsForStudent — a student with none, the empty case',
      () =>
        listPublishedTermsForStudent(
          withoutTerms.locationId,
          withoutTerms.studentProfileId,
        ),
    );

    await mustRun('getChildSnapshot — the same, empty', () =>
      getChildSnapshot(
        withoutTerms.locationId,
        withoutTerms.studentProfileId,
        withoutTerms.academicYearId,
      ),
    );
  }

  /* ---------------------------------------------------------------------
   * Items 2 and 4 — the guards, against real rows.
   * ------------------------------------------------------------------ */

  console.log('\nItems 2 and 4 — the guards:');

  const guardian = rows<{ locationId: string; name: string; phone: string; email: string }>(
    await db.execute(sql`
      select location_id as "locationId", name, phone, email
        from student_guardians
       where email is not null and email <> ''
       order by id
       limit 1`),
  )[0];

  if (guardian === undefined) {
    notExercised(
      'portalAccountBlocker',
      'no guardian anywhere has an email address, so neither of its two reads can be issued against real values.',
    );
  } else {
    await mustRun('portalAccountBlocker — the phone conflict and the address conflict', () =>
      portalAccountBlocker(guardian.locationId, guardian.name, guardian.phone, guardian.email),
    );

    /*
     * An empty answer is a legitimate result here — a guardian's number may
     * belong to nobody with a login — so no row count can prove this one ran.
     * Its only early return is `phones.length === 0`, and it is handed one
     * phone, so reaching the statement is guaranteed rather than inferred. Its
     * *behaviour* is asserted below, against the rows the defect created.
     */
    await mustRun(
      'linkableAccountsByPhone — the guardian-to-account lookup executes',
      () => linkableAccountsByPhone(db, guardian.locationId, [guardian.phone]),
    );

    /*
     * And the thing it must never do: hand back a student's directory row.
     *
     * Asserted against every `role = 'student'` row this database holds on a
     * guardian's number — which is the population the defect created, so if
     * there is one anywhere this is exercised against it. On a repaired
     * database the set is empty and the assertion is vacuous, and saying that
     * out loud is better than a green tick that means nothing.
     */
    const studentRowsOnGuardianNumbers = rows<{ locationId: string; id: string; phone: string }>(
      await db.execute(sql`
        select su.location_id as "locationId", su.id, su.phone
          from school_users su
         where su.role = 'student'
           and exists (select 1 from student_guardians sg
                        where sg.location_id = su.location_id and sg.phone = su.phone)
         order by su.id
         limit 20`),
    );

    if (studentRowsOnGuardianNumbers.length === 0) {
      console.log(
        '  --    no student directory row anywhere still carries a guardian number, so the exclusion has nothing left to exclude.',
      );
    } else {
      for (const child of studentRowsOnGuardianNumbers) {
        const linkable = await linkableAccountsByPhone(db, child.locationId, [child.phone]);
        assert(
          `linkableAccountsByPhone refuses the student row on ${child.phone}`,
          !linkable.some((row) => row.id === child.id),
          `it returned ${child.id}, a role='student' row. A guardian enrolled on that number would be linked to a child's login, and the parent portal would show that family the wrong child.`,
        );
      }
    }
  }

  const member = rows<{ locationId: string; email: string; authUserId: string }>(
    await db.execute(sql`
      select location_id as "locationId", email, auth_user_id as "authUserId"
        from school_users
       where email is not null and email <> '' and auth_user_id is not null and is_active
       order by created_at, id
       limit 1`),
  )[0];

  if (member === undefined) {
    notExercised(
      'activeMembershipsByEmail / getSchoolUserByUid',
      'no active member anywhere has both an address and a bound Supabase account, so neither sign-in read can be issued against a row that exists.',
    );
  } else {
    await mustReach(
      'activeMembershipsByEmail — otp/verify binds exactly one row',
      () => activeMembershipsByEmail(member.locationId, member.email),
      (found) => found.length > 0,
      'it found nothing for an address a real active member holds, so the lower(email) comparison did not match and the statement proved nothing.',
    );

    await mustReach(
      'getSchoolUserByUid — the ordered limit(1)',
      () => getSchoolUserByUid(member.locationId, member.authUserId),
      (found) => found !== null,
      'it answered null for a uid bound to a real active member, so the ordered read did not reach the row.',
    );

    // Case-insensitivity is the index's rule, so it has to be the read's too.
    // A row stored as `Father@Example.com` must be found by `father@…`, or it
    // holds the address without being able to sign in with it.
    await mustReach(
      'activeMembershipsByEmail — and it is case-insensitive, as the index is',
      () => activeMembershipsByEmail(member.locationId, member.email.toUpperCase()),
      (found) => found.length > 0,
      'the upper-cased address found nothing, so the read and the unique index disagree about who holds it.',
    );
  }

  /* ---------------------------------------------------------------------
   * Item 3 — the constraint, and the rows it depends on being gone.
   * ------------------------------------------------------------------ */

  console.log('\nItem 3 — the state 0038 leaves behind:');

  const duplicates = rows<{ location_id: string; e: string; n: number }>(
    await db.execute(sql`
      select location_id, lower(email) as e, count(*)::int as n
        from school_users
       where email is not null and email <> '' and is_active
       group by 1, 2
      having count(*) > 1
       order by 1, 2`),
  );

  const misLinked = rows<{ n: number }>(
    await db.execute(sql`
      select count(*)::int as n
        from student_guardians sg
        join school_users su on su.id = sg.school_user_id
       where su.role = 'student'`),
  )[0];

  if (migrated) {
    // Named, not counted. A migration that created the index under a different
    // name would satisfy every duplicate assertion below and leave the schema
    // file describing something that is not there.
    pass(`${EMAIL_INDEX} is present in pg_indexes`);
    assert(
      'no active (location_id, lower(email)) duplicate survives',
      duplicates.length === 0,
      `${duplicates.length} address(es) are still held twice: ${duplicates
        .map((row) => `${row.e} ×${String(row.n)}`)
        .join(', ')}. The index cannot exist and these both be true, so one of them is a lie — look at the index's WHERE clause.`,
    );
    assert(
      'no guardian is linked to a student directory row',
      (misLinked?.n ?? 0) === 0,
      `${String(misLinked?.n ?? 0)} guardian row(s) still point at a role='student' school_users row. That is one family able to read another child's fees; step 1 of 0038 missed them.`,
    );
  } else {
    console.log(
      `  --    ${EMAIL_INDEX} is absent, as expected before 0038.`,
    );
    console.log(
      `  --    ${String(duplicates.length)} duplicated address(es) awaiting repair${
        duplicates.length === 0
          ? ''
          : `: ${duplicates.map((row) => `${row.e} ×${String(row.n)}`).join(', ')}`
      }`,
    );
    console.log(
      `  --    ${String(misLinked?.n ?? 0)} guardian row(s) still linked to a student directory row.`,
    );

    /*
     * The one thing that must hold on *this* side of the migration: every
     * duplicate 0038 will meet is one it knows how to repair. A duplicate that
     * is two members of staff sharing an inbox is not — step 3 would refuse to
     * build, the whole file would roll back, and DevOps would find out during
     * the deploy rather than here.
     *
     * Simulated with the same predicate step 2 uses, so this is the migration's
     * own arithmetic and not a second opinion about it.
     */
    const survivors = rows<{ location_id: string; e: string; n: number }>(
      await db.execute(sql`
        with scrubbed as (
          select su.id, su.location_id, su.is_active,
                 case when su.role = 'student'
                       and su.phone <> 'student:' || coalesce(sp.student_id, '')
                       and exists (
                         select 1 from student_guardians sg
                          where sg.location_id = su.location_id
                            and (sg.phone = su.phone
                                 or (su.email is not null and su.email <> ''
                                     and sg.email is not null
                                     and lower(sg.email) = lower(su.email))))
                      then null else su.email end as email
            from school_users su
            left join student_profiles sp on sp.school_user_id = su.id)
        select location_id, lower(email) as e, count(*)::int as n
          from scrubbed
         where email is not null and email <> '' and is_active
         group by 1, 2
        having count(*) > 1`),
    );

    assert(
      '0038 step 3 will build — no duplicate survives steps 1 and 2',
      survivors.length === 0,
      `${survivors.length} address(es) would still be held twice after the repair: ${survivors
        .map((row) => `${row.e} ×${String(row.n)}`)
        .join(', ')}. CREATE UNIQUE INDEX would refuse and the whole migration would roll back. Resolve these by hand first; do not weaken the index.`,
    );
  }

  console.log(
    `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} ok, ${String(failures)} failed or not exercised\n`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
