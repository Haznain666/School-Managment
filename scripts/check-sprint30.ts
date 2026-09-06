/**
 * Executes Sprint 30's new and widened statements against the real schema.
 *
 *     npm run check-sprint30
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * A green build says the SQL compiled, never that Postgres would accept it. An
 * ambiguous column reference is a *planning* error — 42702 is raised when the
 * statement is resolved, not when it returns rows — so a statement that has
 * been read and not run is evidence about spelling and nothing else. That is
 * how 42702 shipped three times.
 *
 * ── There is no migration, which raises the bar rather than lowering it ───
 * Every statement below **must execute**. There is no `42P01` / `42703` to
 * predict and therefore nothing to hide behind: a failure here is a real
 * defect. The one that earns this script on its own is `listInbox`.
 *
 * ── `listInbox` is the statement to worry about ──────────────────────────
 * It already joined four tables and aggregated `school_users.name` into an
 * alias whose docblock explains, at length, what Sprint 18 paid for colliding
 * with `school_users.phone`. Sprint 30 adds a **second `school_users`** to the
 * same statement — the person holding a desk thread — so `name` now exists
 * three times in one query.
 *
 * It is joined through `alias()` rather than a `sql` template, which is the
 * distinction `CLAUDE.md` draws: an aliased *table* is qualified by Drizzle on
 * every reference, a `sql` alias is emitted bare. That is the theory. This
 * script is the evidence, because only Postgres resolves a name.
 *
 * ── What else is new ─────────────────────────────────────────────────────
 *   · `deskStaff` — who is on a desk (`lib/chat-desks.ts`)
 *   · `branchOfParent` — the campus a parent's children sit at
 *   · `teachersOfChildren` — widened with `role = 'teacher'` on both halves
 *   · the three campus reads behind the header (`lib/branch-header.ts`)
 *   · `ensureDefaultSections` — the grades-with-no-section read, and the
 *     insert, which is proved by writing inside a transaction that is always
 *     rolled back (Trap 2: a write that matches no row proves nothing)
 *
 * ── The three traps, all paid for by earlier sprints ─────────────────────
 * 1. The SQLSTATE lives on the error's `cause` chain, not on the error.
 * 2. A read that short-circuits before reaching the new column must be
 *    reported as **not exercised**, never as a pass.
 * 3. postgres-js appends the whole failed query to the message; the `cause`
 *    carries the bare reason, so that is what is printed.
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

async function main(): Promise<void> {
  /* ═════════════════════════════════════ the pure assertions, no database */

  console.log('\nThe desks, and who is on them:');

  const { ROLE_INBOXES, ROLE_INBOX_KEYS, DESK_FALLBACK_ROLE, roleInboxLabel } = await import(
    '../db/schema/chat-conversations'
  );
  const { claimableInboxes } = await import('../lib/chat-queries');
  const { USER_ROLES } = await import('../types/school-auth');

  assert(
    'no desk lists the school admin as an answerer any more',
    ROLE_INBOXES.every(
      (inbox) => !(inbox.answeredBy as readonly string[]).includes(DESK_FALLBACK_ROLE),
    ),
    ROLE_INBOXES.filter((inbox) =>
      (inbox.answeredBy as readonly string[]).includes(DESK_FALLBACK_ROLE),
    )
      .map((inbox) => inbox.key)
      .join(', '),
  );

  assert(
    'every desk still has somebody who owns it',
    ROLE_INBOXES.every((inbox) => inbox.answeredBy.length > 0),
    'a desk with an empty answeredBy would be unreachable at every school',
  );

  assert(
    'every answering role is a real role',
    ROLE_INBOXES.every((inbox) =>
      (inbox.answeredBy as readonly string[]).every((role) =>
        (USER_ROLES as readonly string[]).includes(role),
      ),
    ),
    'a role that is not in USER_ROLES can never match a school_users row',
  );

  assert(
    'the school admin may still claim all four',
    claimableInboxes('school_admin').length === ROLE_INBOX_KEYS.length,
    `claims ${String(claimableInboxes('school_admin').length)} of ${String(ROLE_INBOX_KEYS.length)}`,
  );

  assert(
    'an accountant may claim Accounts and nothing else',
    claimableInboxes('accountant').join(',') === 'accounts',
    claimableInboxes('accountant').join(',') || '(none)',
  );

  assert(
    'a head may claim the head’s office and nothing else',
    claimableInboxes('principal').join(',') === 'principal',
    claimableInboxes('principal').join(',') || '(none)',
  );

  assert(
    'a teacher may claim nothing',
    claimableInboxes('teacher').length === 0,
    claimableInboxes('teacher').join(','),
  );

  assert(
    'every desk has a label for the inbox to show instead of “The school”',
    ROLE_INBOX_KEYS.every((key) => roleInboxLabel(key) !== key && roleInboxLabel(key) !== ''),
    ROLE_INBOX_KEYS.map((key) => `${key}→${roleInboxLabel(key)}`).join(', '),
  );

  console.log('\nThe section default:');

  const { DEFAULT_SECTION_NAME, DEFAULT_SECTION_CAPACITY } = await import(
    '../lib/default-sections'
  );

  assert(
    'Section A, capacity 35',
    DEFAULT_SECTION_NAME === 'A' && DEFAULT_SECTION_CAPACITY === 35,
    `${DEFAULT_SECTION_NAME} / ${String(DEFAULT_SECTION_CAPACITY)}`,
  );

  /* ═════════════════════════════════ the statements, against the real schema */

  console.log('\nlistInbox — three `name` columns in one statement:');

  await mustRun(
    'the inbox, with the claimant join and the counterparty aggregate together',
    async () => {
      const { listInbox } = await import('../lib/chat-queries');
      return listInbox('no-such-tenant', NOBODY);
    },
  );

  /*
   * Trap 2. The read above matched no row, so it planned and returned nothing.
   * Planning is exactly what 42702 is raised by — so for this statement the
   * plan *is* the proof. What it does not prove is the mapping, so the same
   * statement is run again against a tenant that has conversations, and the
   * desk rows are required to be titled by their desk rather than by a person.
   */
  const realMember = rows<{ id: string; location_id: string }>(
    await db.execute(sql`
      select p.school_user_id as id, p.location_id
        from chat_participants p
        join chat_conversations c on c.id = p.conversation_id
       where c.kind = 'role_inbox'
       limit 1
    `),
  );

  const deskSeat = realMember[0];

  if (deskSeat === undefined) {
    console.log('  note  no desk thread exists on this database — the labelling was not exercised');
    console.log('        Open one from a parent portal, or accept this as unproved.');
    failures += 1;
  } else {
    const { listInbox } = await import('../lib/chat-queries');
    const inbox = await listInbox(deskSeat.location_id, deskSeat.id);
    const desks = inbox.filter((row) => row.kind === 'role_inbox');

    assert(
      'a real desk thread is titled by its desk, not by a person or “The school”',
      desks.length > 0 &&
        desks.every((row) => row.counterparty !== 'The school' && row.roleInbox !== null),
      desks.map((row) => `${String(row.roleInbox)}→${row.counterparty}`).join(', ') ||
        'no desk rows came back for this seat',
    );
  }

  console.log('\nThe desk routing reads:');

  await mustRun('deskStaff — every role that answers any desk, one query', async () => {
    const { desksWithAnswerers } = await import('../lib/chat-desks');
    return desksWithAnswerers('no-such-tenant', null);
  });

  await mustRun('deskAnswerers for one desk, scoped to one campus', async () => {
    const { deskAnswerers } = await import('../lib/chat-desks');
    return deskAnswerers('no-such-tenant', 'accounts', NOBODY);
  });

  console.log('\nThe parent’s reachable list:');

  await mustRun('branchOfParent — guardians ⋈ enrolments ⋈ sections ⋈ grades', async () => {
    const { branchOfParent } = await import('../lib/chat-queries');
    return branchOfParent('no-such-tenant', NOBODY);
  });

  await mustRun(
    'resolveReachable as a parent — desks filtered by who answers, teachers by role',
    async () => {
      const { resolveReachable } = await import('../lib/chat-queries');
      return resolveReachable('no-such-tenant', { schoolUserId: NOBODY, role: 'parent' });
    },
  );

  /*
   * Trap 2 again, and this one matters more than the plan.
   *
   * The defect being fixed is that a **school administrator** appeared in a
   * parent's teacher list because they were in a timetable. Against a tenant
   * matching no row that is unprovable, so this runs against every real parent
   * with at least one child and requires that nothing non-teaching comes back.
   */
  const parents = rows<{ id: string; location_id: string }>(
    await db.execute(sql`
      select distinct u.id, u.location_id
        from school_users u
        join student_guardians g on g.school_user_id = u.id
       where u.role = 'parent' and u.is_active = true
       limit 5
    `),
  );

  if (parents.length === 0) {
    console.log('  note  no parent with a child on this database — the filter was not exercised');
    failures += 1;
  } else {
    const { resolveReachable } = await import('../lib/chat-queries');
    const { schoolUsers } = await import('../db/schema/school-users');
    const { inArray } = await import('drizzle-orm');

    let checked = 0;
    let offenders: string[] = [];

    for (const parent of parents) {
      const targets = await resolveReachable(parent.location_id, {
        schoolUserId: parent.id,
        role: 'parent',
      });

      const people = targets.filter((target) => target.kind === 'person');
      if (people.length === 0) continue;

      checked += people.length;

      const roles = await db
        .select({ id: schoolUsers.id, name: schoolUsers.name, role: schoolUsers.role })
        .from(schoolUsers)
        .where(
          inArray(
            schoolUsers.id,
            people.map((person) => person.id),
          ),
        );

      offenders = [
        ...offenders,
        ...roles.filter((row) => row.role !== 'teacher').map((row) => `${row.name} (${row.role})`),
      ];
    }

    if (checked === 0) {
      console.log('  note  no parent on this database reaches anybody — the filter was not exercised');
      failures += 1;
    } else {
      assert(
        `every person a parent can reach is a teacher (${String(checked)} checked)`,
        offenders.length === 0,
        offenders.join(', '),
      );
    }
  }

  console.log('\nThe portal header’s campus:');

  await mustRun('headerBranchName for a staff seat', async () => {
    const { headerBranchName } = await import('../lib/branch-header');
    return headerBranchName({
      locationId: 'no-such-tenant',
      role: 'teacher',
      schoolUserId: NOBODY,
      branchId: NOBODY,
    });
  });

  await mustRun('headerBranchName for a parent — the campus of their children', async () => {
    const { headerBranchName } = await import('../lib/branch-header');
    return headerBranchName({
      locationId: 'no-such-tenant',
      role: 'parent',
      schoolUserId: NOBODY,
      branchId: null,
    });
  });

  await mustRun('headerBranchName for a pupil — the campus of their enrolment', async () => {
    const { headerBranchName } = await import('../lib/branch-header');
    return headerBranchName({
      locationId: 'no-such-tenant',
      role: 'student',
      schoolUserId: NOBODY,
      branchId: null,
    });
  });

  /*
   * The school admin is the requirement's exception, and it is decided before
   * any query runs — so it is asserted rather than executed.
   */
  const { headerBranchName } = await import('../lib/branch-header');
  const realSchool = rows<{ location_id: string }>(
    await db.execute(sql`
      select s.location_id
        from schools s
        join branches b on b.location_id = s.location_id and b.is_active = true
       group by s.location_id
      having count(b.id) > 1
       limit 1
    `),
  );

  const multiCampus = realSchool[0];

  if (multiCampus === undefined) {
    console.log('  note  no multi-campus school on this database — the header was not exercised');
    failures += 1;
  } else {
    const staffSeat = rows<{ id: string; branch_id: string | null }>(
      await db.execute(sql`
        select id, branch_id
          from school_users
         where location_id = ${multiCampus.location_id}
           and branch_id is not null
           and is_active = true
         limit 1
      `),
    );

    const seat = staffSeat[0];

    assert(
      'a school admin is given no campus even at a school with several',
      (await headerBranchName({
        locationId: multiCampus.location_id,
        role: 'school_admin',
        schoolUserId: seat?.id ?? NOBODY,
        branchId: seat?.branch_id ?? null,
      })) === null,
      'a school-wide account was labelled with one campus',
    );

    if (seat === undefined) {
      console.log('  note  no branch-bound member of staff — the campus label was not exercised');
      failures += 1;
    } else {
      const label = await headerBranchName({
        locationId: multiCampus.location_id,
        role: 'branch_admin',
        schoolUserId: seat.id,
        branchId: seat.branch_id,
      });

      assert(
        'a campus-bound member of staff is given their campus by name',
        label !== null && label !== '',
        String(label),
      );
    }
  }

  console.log('\nThe default section:');

  await mustRun('the grades-with-no-section read', async () => {
    const { ensureDefaultSections } = await import('../lib/default-sections');
    return ensureDefaultSections({
      locationId: 'no-such-tenant',
      academicYearId: NOBODY,
    });
  });

  /*
   * Trap 2. The read above found nothing, so the **insert never ran** — and an
   * insert that never ran is not evidence. This one writes, against a real
   * grade in a real year, inside a transaction that is always rolled back.
   */
  const target = rows<{ location_id: string; grade_id: string; year_id: string }>(
    await db.execute(sql`
      select g.location_id, g.id as grade_id, y.id as year_id
        from grades g
        join academic_years y on y.location_id = g.location_id
       where not exists (
         select 1 from sections s
          where s.grade_id = g.id and s.academic_year_id = y.id
       )
       limit 1
    `),
  );

  const slot = target[0];

  if (slot === undefined) {
    console.log('  note  every grade already has a section in every year — the insert was not exercised');
    console.log('        That is the state this sprint is aiming at, so it is reported, not failed.');
  } else {
    const before = rows<{ n: number }>(
      await db.execute(sql`select count(*)::int as n from sections`),
    );

    try {
      await db.transaction(async (tx) => {
        const { sections } = await import('../db/schema/sections');

        const created = await tx
          .insert(sections)
          .values({
            locationId: slot.location_id,
            gradeId: slot.grade_id,
            academicYearId: slot.year_id,
            name: DEFAULT_SECTION_NAME,
            capacity: DEFAULT_SECTION_CAPACITY,
          })
          .onConflictDoNothing({
            target: [sections.gradeId, sections.academicYearId, sections.name],
          })
          .returning({ id: sections.id });

        assert(
          'Section A is created for a grade that has none',
          created.length === 1,
          `inserted ${String(created.length)} row(s)`,
        );

        const again = await tx
          .insert(sections)
          .values({
            locationId: slot.location_id,
            gradeId: slot.grade_id,
            academicYearId: slot.year_id,
            name: DEFAULT_SECTION_NAME,
            capacity: DEFAULT_SECTION_CAPACITY,
          })
          .onConflictDoNothing({
            target: [sections.gradeId, sections.academicYearId, sections.name],
          })
          .returning({ id: sections.id });

        assert(
          'a second run adds nothing — the unique index is the second guard',
          again.length === 0,
          `inserted ${String(again.length)} row(s) on the second attempt`,
        );

        tx.rollback();
      });
    } catch (error) {
      const state = sqlState(error);
      const message = String((error as { message?: string } | null)?.message ?? error);
      if (state !== null || !message.toLowerCase().includes('rollback')) {
        fail('the default-section transaction', describe(error));
      }
    }

    const after = rows<{ n: number }>(
      await db.execute(sql`select count(*)::int as n from sections`),
    );

    assert(
      'nothing survived the rollback',
      (before[0]?.n ?? -1) === (after[0]?.n ?? -2),
      `sections moved from ${String(before[0]?.n)} to ${String(after[0]?.n)}`,
    );
  }

  console.log('\nThe module gate:');

  await mustRun('getModuleFlags, which every gated chat route now reads', async () => {
    const { getModuleFlags } = await import('../lib/school-queries');
    return getModuleFlags('no-such-tenant');
  });

  const { PLATFORM_MODULE_KEYS } = await import('../lib/platform-modules');

  assert(
    'chat is a module the super admin can offer one school and not another',
    (PLATFORM_MODULE_KEYS as readonly string[]).includes('chat'),
    PLATFORM_MODULE_KEYS.join(', '),
  );

  console.log('\nThe unchanged statements this sprint leans on:');

  await mustRun('listDueAnnouncements — the sweep the auto-send shares a rule with', async () => {
    const { listDueAnnouncements } = await import('../lib/announcement-queries');
    return listDueAnnouncements(new Date());
  });

  await mustRun('countUnreadConversations, which desk seats now move', async () => {
    const { countUnreadConversations } = await import('../lib/chat-queries');
    return countUnreadConversations('no-such-tenant', NOBODY);
  });

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
