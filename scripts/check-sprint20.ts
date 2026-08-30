/**
 * Executes Sprint 20's new and widened statements against the real schema.
 *
 * ── Why this exists, and why it runs *before* the migration ──────────────
 * `scripts/print-sprint20-sql.ts` prints `toSQL()` and proves **naming**: that
 * every column reference is qualified and every alias is unique. That is worth
 * having and it is not enough. An ambiguous column reference is a *planning*
 * error — Postgres raises 42702 when it resolves the statement, not when it
 * returns rows — so the only thing that settles it is handing the statement to
 * a server.
 *
 * STATE.md §5bg records the cost of not doing that: `listStudents` aliased a
 * raw-`sql` subquery column `phone`, Drizzle emitted it unqualified, it
 * collided with the joined `school_users.phone`, and the all-students screen
 * was a 500 **at every school** for as long as it was live. Nine green gates
 * could not see it, because none of them executes a query. This one does.
 *
 * Sprint 20 reopens exactly that surface: `listSchoolUsers` now carries an
 * ordered aggregate over the guardian's phone on a statement that also joins
 * `school_users.phone`. It is the same shape, one screen over.
 *
 *     npm run check-sprint20
 *
 * ── The split, and why a failure is sometimes the pass ───────────────────
 * The statements divide in two:
 *
 *   · those needing nothing from `0037` **must execute**. They are the ones
 *     that are about to ship over an unmigrated database if the deploy order
 *     slips, and they are the ones this script exists for;
 *   · those reading a column or table `0037` adds **must fail with exactly the
 *     missing-relation or missing-column error**, and any *other* error is a
 *     real finding. That is §5bi's method: the predicted failure is itself the
 *     check, and it stops being expected the moment `0037` is applied.
 *
 * Run it again after applying `0037` and every statement must execute. The
 * script says which mode it is in rather than being told, by reading whether
 * `bank_accounts` exists.
 *
 * A location id that matches no school is used throughout, so every statement
 * parses, resolves every column, plans, executes and returns nothing. No real
 * school's data is read and nothing is written.
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

/**
 * The SQLSTATE, dug out from under Drizzle's wrapper.
 *
 * Drizzle throws a `DrizzleQueryError` whose own `code` is undefined and whose
 * `cause` is the postgres-js error carrying the real one. Reading `error.code`
 * directly answers `undefined` for **every** failure, which would have made
 * every predicted refusal below look like an unpredicted one — so the chain is
 * walked rather than the top level read.
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

/**
 * The error Postgres raises for a relation or column `0037` has not created.
 *
 * Matched on the SQLSTATE rather than on the message text, because the message
 * is localised and the code is not. `42P01` is undefined_table, `42703` is
 * undefined_column.
 */
function isMissingSchema(error: unknown): boolean {
  const code = sqlState(error);
  return code === '42P01' || code === '42703';
}

/**
 * The SQLSTATE and the reason, without the statement.
 *
 * postgres-js appends the whole failed query and its parameters to the message
 * — several hundred characters of SQL on a summary line, which buries the ten
 * words that matter. The `cause` carries the bare reason, so it is preferred;
 * the outer message is trimmed as a fallback.
 */
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
  const trimmed = oneLine.length > 90 ? `${oneLine.slice(0, 89)}…` : oneLine;

  return `${sqlState(error) ?? '?'} ${trimmed}`;
}

/** A statement that must execute whatever state the database is in. */
async function mustRun(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    console.log(`  ok    ${label}`);
    passes += 1;
  } catch (error) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${describe(error)}`);
    failures += 1;
  }
}

/**
 * A statement that reads something `0037` adds.
 *
 * Before the migration it must fail, and fail *only* with a missing-relation or
 * missing-column error — anything else is a defect wearing a predicted
 * failure's clothes, which is the one way this check could lie. After the
 * migration it must execute like everything else.
 */
async function mustRunAfterMigration(
  label: string,
  migrated: boolean,
  run: () => Promise<unknown>,
): Promise<void> {
  if (migrated) {
    await mustRun(label, run);
    return;
  }

  try {
    await run();
    /*
     * Not a failure, and it took a wrong assertion here to see why.
     *
     * Several of these read a student, a scheme or a voucher *first* and return
     * early when the id matches nothing — which it never does, by design. The
     * statement carrying the new column is then never issued, so the function
     * completes without ever asking the database for anything `0037` adds.
     *
     * That is a statement this run did not exercise, which is worth saying
     * plainly and is not evidence of anything either way. Counting it as a pass
     * would be worse: it would let a genuinely broken statement hide behind a
     * short circuit.
     */
    console.log(`  --    ${label} — short-circuited before the new column; not exercised`);
  } catch (error) {
    if (isMissingSchema(error)) {
      console.log(`  ok    ${label} — refused as predicted, ${describe(error)}`);
      passes += 1;
      return;
    }
    console.error(`  FAIL  ${label} — failed, but not for the predicted reason`);
    console.error(`        ${describe(error)}`);
    failures += 1;
  }
}

async function main(): Promise<void> {
  const { db } = await import('../lib/drizzle');

  // Which mode this run is in, read rather than assumed.
  const probe = await db.execute(
    sql`select to_regclass('public.bank_accounts') is not null as present`,
  );
  const migrated = Boolean((probe as unknown as { present: boolean }[])[0]?.present);

  console.log(
    migrated
      ? '\n0037 IS APPLIED — every statement must execute.\n'
      : '\n0037 is NOT applied — the four statements that read it must refuse, and only for that reason.\n',
  );

  /* ---------------------------------------------------------------------
   * Needs nothing from 0037. These must execute today.
   * ------------------------------------------------------------------ */

  console.log('Statements that ship over an unmigrated database:');

  // §5bg's shape, one screen over: an ordered aggregate over the guardian's
  // phone on a statement that also joins `school_users.phone`. This is the
  // single highest-risk statement in the sprint.
  await mustRun('listSchoolUsers — the users list, page query', async () => {
    const { listSchoolUsers } = await import('../lib/school-queries');
    return listSchoolUsers(NOBODY, {});
  });

  // Six tables, and the read the whole sibling rule rests on.
  await mustRun('siblingStandingFor — who has a brother or sister here', async () => {
    const { siblingStandingFor } = await import('../lib/sibling-discounts');
    return siblingStandingFor(NOBODY, NOBODY);
  });

  await mustRun('listSiblings — cross-campus, with the campus columns', async () => {
    const { listSiblings } = await import('../lib/siblings');
    return listSiblings(NOBODY, NOBODY);
  });

  await mustRun('listDefaulters — the aged debt read', async () => {
    const { listDefaulters } = await import('../lib/defaulters');
    return listDefaulters(NOBODY, {});
  });

  /* ---------------------------------------------------------------------
   * Reads something 0037 adds.
   * ------------------------------------------------------------------ */

  console.log('\nStatements that need 0037:');

  /*
   * Eight tables, four of which have a `name` — and it belongs here rather
   * than above because it now selects `schools.ntn`, `.website` and
   * `.finance_email`, which `0037` adds. That is the single most important
   * line in this script's classification: **the printed voucher is down at
   * every school until `0037` is applied**, and the DDL notes' hazard table
   * has to say so.
   */
  await mustRunAfterMigration('getChallanDetail — the voucher detail, eight tables', migrated, async () => {
    const { getChallanDetail } = await import('../lib/fee-queries');
    return getChallanDetail(NOBODY, NOBODY);
  });

  await mustRunAfterMigration('listBankAccounts', migrated, async () => {
    const { listBankAccounts } = await import('../lib/bank-accounts');
    return listBankAccounts(NOBODY);
  });

  await mustRunAfterMigration('listVoucherBankAccounts', migrated, async () => {
    const { listVoucherBankAccounts } = await import('../lib/bank-accounts');
    return listVoucherBankAccounts(NOBODY, null);
  });

  await mustRunAfterMigration('listConcessionSchemes — with scheme_type', migrated, async () => {
    const { listConcessionSchemes } = await import('../lib/concession-schemes');
    return listConcessionSchemes(NOBODY);
  });

  await mustRunAfterMigration('activeSiblingSchemes', migrated, async () => {
    const { activeSiblingSchemes } = await import('../lib/sibling-discounts');
    return activeSiblingSchemes(NOBODY);
  });

  await mustRunAfterMigration('siblingPolicyFor — the two new settings', migrated, async () => {
    const { siblingPolicyFor } = await import('../lib/sibling-discounts');
    return siblingPolicyFor(NOBODY);
  });

  await mustRunAfterMigration('getStudentDiscountState', migrated, async () => {
    const { getStudentDiscountState } = await import('../lib/student-discounts');
    return getStudentDiscountState(NOBODY, NOBODY);
  });

  console.log(
    `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${String(passes)} ok, ${String(failures)} failed\n`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
