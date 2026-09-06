/**
 * Sprint 30's data step. There is no migration.
 *
 *     node scripts/apply-sprint30-data.mjs          # reads, changes nothing
 *     node scripts/apply-sprint30-data.mjs --apply  # writes
 *
 * ── What it does ─────────────────────────────────────────────────────────
 * **Every grade with no section in its school's active year gets Section A,
 * capacity 35.**
 *
 * A grade with no section is a rung nobody can be enrolled into: a child is
 * placed in a *section*, the timetable is built per section, and the class
 * teacher hangs off one. Seeding the ladder created sixteen grades and no
 * classes, and the second step was undocumented — so the enrolment wizard's
 * section dropdown was empty at a school that had done everything the screen
 * asked of it.
 *
 * The code half of this sprint creates the same row on every future seed and
 * on the year that a new run makes active (`lib/default-sections.ts`). This
 * script is the estate that already exists.
 *
 * ── Which year ───────────────────────────────────────────────────────────
 * The **active** one, resolved exactly as `getActiveAcademicYear` resolves it:
 * the flagged year if there is one, otherwise the earliest-starting year that
 * contains today. A school with no such year is reported and skipped — writing
 * sections into a year nobody is enrolling into is worse than writing none.
 *
 * ── Idempotent ───────────────────────────────────────────────────────────
 * The read finds nothing on a second run, and the unique index on
 * `(grade_id, academic_year_id, name)` is the second guard. A grade that
 * already has *any* section is left alone: a school that runs "Blue" and
 * "Green" has answered this question, and adding A would be the product
 * arguing with them.
 *
 * Reversible: `DELETE FROM sections WHERE name = 'A' AND capacity = 35` for the
 * ids this prints, and only while nothing has been enrolled into them.
 *
 * -- 2. Existing desk threads get the staff who answer them ---------------
 * A desk thread opened before this sprint has **one participant** - the parent
 * who wrote it. `listInbox` reads through participant rows, so those enquiries
 * sit in nobody's inbox, move no badge and ring no bell; the only way to one
 * was `POST .../claim` with an id nothing displayed. Lahore Grammar has three
 * of them and nobody at the school has ever seen one.
 *
 * The code half seats the answerers when a thread *opens*
 * (`lib/chat-desks.ts`). This is the backlog, seated by the same rule: the
 * desk's own roles at that thread's campus, falling back to the school admin
 * when the school has appointed nobody.
 *
 * No bell entry is written for these. The bell says *a message has arrived*,
 * and these arrived weeks ago; the inbox's own unread dot is the honest
 * signal, and it follows from `last_read_at` being null.
 *
 * Reversible: delete the `chat_participants` rows this prints.
 */

import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

function loadDatabaseUrl() {
  for (const candidate of ['D:/School-Management-System/.env.local', '.env.local']) {
    try {
      const text = readFileSync(candidate, 'utf8');
      const match = /^DATABASE_URL=(.*)$/m.exec(text);
      if (match?.[1] !== undefined) {
        return match[1].trim().replace(/^['"]|['"]$/g, '');
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('DATABASE_URL not found');
}

const sql = postgres(loadDatabaseUrl(), { prepare: false });

const DEFAULT_NAME = 'A';
const DEFAULT_CAPACITY = 35;

/**
 * The year the school is actually running, by the same rule the app uses.
 *
 * `is_active` first, then the earliest-starting year containing today. The
 * ordering matters at a group: an April–March session and an August–July one
 * both contain today in May, and the app picks the earlier-starting one, so
 * this must pick the same or the sections land on a year no screen reads.
 */
async function activeYear(locationId) {
  const rows = await sql`
    select id, name, is_active
      from academic_years
     where location_id = ${locationId}
       and (
         is_active = true
         or (
           make_date(start_year, start_month, 1) <= current_date
           and (make_date(end_year, end_month, 1) + interval '1 month') > current_date
         )
       )
     order by is_active desc, start_year asc, start_month asc
     limit 1
  `;

  return rows[0] ?? null;
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'dry run — nothing is written'}`);

  const schools = await sql`select location_id, name from schools order by name`;
  let created = 0;
  let skipped = 0;

  for (const school of schools) {
    const year = await activeYear(school.location_id);

    if (year === null) {
      console.log(`\n${school.name}: no active academic year — skipped`);
      continue;
    }

    const missing = await sql`
      select g.id, g.name, g.sort_order, b.name as branch_name
        from grades g
        join branches b on b.id = g.branch_id
       where g.location_id = ${school.location_id}
         and not exists (
           select 1
             from sections s
            where s.grade_id = g.id
              and s.academic_year_id = ${year.id}
         )
       order by b.name, g.sort_order
    `;

    console.log(
      `\n${school.name} — ${year.name}${year.is_active ? '' : ' (current by calendar)'}: ` +
        `${String(missing.length)} grade(s) with no section`,
    );

    for (const grade of missing) {
      console.log(`  ${grade.branch_name} · ${grade.name}`);
    }

    if (!APPLY || missing.length === 0) {
      skipped += missing.length;
      continue;
    }

    const inserted = await sql`
      insert into sections (location_id, grade_id, academic_year_id, name, capacity)
      select ${school.location_id}, g.id, ${year.id}, ${DEFAULT_NAME}, ${DEFAULT_CAPACITY}
        from grades g
       where g.location_id = ${school.location_id}
         and not exists (
           select 1
             from sections s
            where s.grade_id = g.id
              and s.academic_year_id = ${year.id}
         )
      on conflict (grade_id, academic_year_id, name) do nothing
      returning id
    `;

    created += inserted.length;
    console.log(`  → created ${String(inserted.length)}`);
  }

  console.log(
    `\n${APPLY ? `created ${String(created)} section(s)` : `${String(skipped)} section(s) would be created`}`,
  );

  await seatDeskThreads();

  await sql.end();
}

/**
 * The desks each role answers, and the one that answers when nobody does.
 *
 * A copy of `ROLE_INBOXES`, because a `.mjs` script cannot import a TypeScript
 * module without a build step. It is checked against the source of truth below
 * rather than trusted, and a divergence stops the run.
 */
const DESK_ROLES = {
  office: ['branch_admin', 'coordinator'],
  accounts: ['branch_admin', 'accountant'],
  admissions: ['branch_admin', 'coordinator', 'marketing'],
  principal: ['principal', 'vice_principal'],
};

const FALLBACK_ROLE = 'school_admin';

/** Guards the copy above against the file it copies. */
function assertDesksMatchSource() {
  const source = readFileSync('db/schema/chat-conversations.ts', 'utf8');

  for (const [key, roles] of Object.entries(DESK_ROLES)) {
    for (const role of roles) {
      if (!source.includes(`'${role}'`)) {
        throw new Error(`desk ${key} names ${role}, which the schema file does not`);
      }
    }
  }

  if (!source.includes(`DESK_FALLBACK_ROLE = '${FALLBACK_ROLE}'`)) {
    throw new Error('the fallback role here is not the one the schema declares');
  }
}

/**
 * Seats the answering staff on desk threads opened before this sprint.
 *
 * Only open, unclaimed ones: a closed thread is history, and a claimed one
 * already has its owner seated by the claim route.
 */
async function seatDeskThreads() {
  assertDesksMatchSource();

  console.log('\n\n-- Desk threads with no staff seat --');

  const threads = await sql`
    select c.id,
           c.location_id,
           c.branch_id,
           c.role_inbox,
           c.subject,
           s.name as school_name
      from chat_conversations c
      join schools s on s.location_id = c.location_id
     where c.kind = 'role_inbox'
       and c.status = 'open'
       and c.claimed_by is null
       and not exists (
         select 1
           from chat_participants p
           join school_users u on u.id = p.school_user_id
          where p.conversation_id = c.id
            and u.role <> 'parent'
            and u.role <> 'student'
       )
     order by s.name, c.created_at
  `;

  if (threads.length === 0) {
    console.log('  none - every open desk thread already has somebody in it');
    return;
  }

  let seated = 0;

  for (const thread of threads) {
    const roles = DESK_ROLES[thread.role_inbox] ?? [];

    const owners = await sql`
      select id, name, role
        from school_users
       where location_id = ${thread.location_id}
         and is_active = true
         and role = any(${roles})
         and (branch_id is null or ${thread.branch_id}::uuid is null or branch_id = ${thread.branch_id})
       order by name
    `;

    const answerers =
      owners.length > 0
        ? owners
        : await sql`
            select id, name, role
              from school_users
             where location_id = ${thread.location_id}
               and is_active = true
               and role = ${FALLBACK_ROLE}
               and (branch_id is null or ${thread.branch_id}::uuid is null or branch_id = ${thread.branch_id})
             order by name
          `;

    console.log(
      `  ${thread.school_name} - ${thread.role_inbox} - ${thread.subject ?? 'no subject'} => ` +
        (answerers.length === 0
          ? 'NOBODY (this school has nobody on that desk and no active admin)'
          : answerers.map((row) => `${row.name} (${row.role})`).join(', ')),
    );

    if (!APPLY || answerers.length === 0) continue;

    const inserted = await sql`
      insert into chat_participants
        (location_id, conversation_id, school_user_id, participant_role, can_post, is_student, is_parent)
      select ${thread.location_id}, ${thread.id}, u.id, 'member', true, false, false
        from school_users u
       where u.id = any(${answerers.map((row) => row.id)})
      on conflict do nothing
      returning id
    `;

    seated += inserted.length;
  }

  console.log(
    `\n${APPLY ? `seated ${String(seated)} member(s) of staff` : 'nothing seated - dry run'}`,
  );
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
