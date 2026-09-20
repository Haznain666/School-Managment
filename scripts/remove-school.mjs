#!/usr/bin/env node

/**
 * Removes a tenant and everything it owns — database rows, GoTrue accounts and
 * Storage objects — or, with no `--apply`, reports exactly what it would take.
 *
 * ── Read this before running it with `--apply` ───────────────────────────
 * There is no undo. Supabase's free plan keeps no point-in-time recovery, so
 * the only way back is a backup taken before the run. `--apply` refuses to
 * start unless `--i-have-a-backup` is given with it, which is the closest
 * thing to a seatbelt a one-way operation can have.
 *
 * ── Why a `DELETE FROM schools` is very nearly enough ────────────────────
 * 112 of the 114 tables carrying `location_id` reach `schools.location_id`
 * through a foreign key declared `ON DELETE CASCADE`, so one delete unwinds
 * the tenant in dependency order without this script needing to know the
 * order. Read from `pg_constraint` on 2026-09-20, not assumed.
 *
 * The two that do not are handled by hand:
 *
 *   `schools`      — the row being deleted; it references nothing.
 *   `email_outbox` — carries `location_id` with no foreign key, because a
 *                    queued message outlives the thing that queued it. Nothing
 *                    cascades to it, so it is deleted first and explicitly.
 *
 * The script does not hardcode that list. It re-derives it from the catalogue
 * every run and **fails** if it finds a `location_id` table that neither
 * cascades nor is named above — a table added later with a different delete
 * rule would otherwise leave rows behind silently, which is the failure this
 * whole file exists to avoid.
 *
 * ── GoTrue accounts are deleted only when they belong to no one else ─────
 * `school_users.auth_user_id` is the link. An account appearing under two
 * tenants is left alone and reported: deleting it would sign a real person out
 * of a school that is not being removed. Sprint 21 made one email one person,
 * so this should find nothing — "should" is why it is checked rather than
 * assumed.
 *
 * ── Storage is emptied through the API, not through `storage.objects` ────
 * Deleting rows from `storage.objects` orphans the bytes in the backing
 * bucket: the metadata goes, the file stays, and it goes on being billed. The
 * Storage API is the only door that removes both, so files are listed and
 * removed with the service-role key.
 *
 * Usage:
 *   node scripts/remove-school.mjs <location_id> [<location_id> …]
 *   node scripts/remove-school.mjs <location_id> --apply --i-have-a-backup
 */

import { readFileSync } from 'node:fs';

import postgres from 'postgres';

const ENV_PATH = 'D:/School-Management-System/.env.local';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BACKED_UP = args.includes('--i-have-a-backup');
const targets = args.filter((a) => !a.startsWith('--'));

if (targets.length === 0) {
  console.error('usage: node scripts/remove-school.mjs <location_id> [...] [--apply --i-have-a-backup]');
  process.exit(2);
}
if (APPLY && !BACKED_UP) {
  console.error(
    'refusing: --apply needs --i-have-a-backup too.\n' +
      'This deletes tenant data irreversibly and this project has no PITR.',
  );
  process.exit(2);
}

const env = readFileSync(ENV_PATH, 'utf8');
const readEnv = (key) =>
  (new RegExp(`^${key}=(.*)$`, 'm').exec(env) ?? [])[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';

const url = readEnv('DATABASE_URL').replace(':6543/', ':5432/');
const supabaseUrl = readEnv('SUPABASE_URL').replace(/\/+$/, '');
const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
const bucket = readEnv('SUPABASE_STORAGE_BUCKET') || 'school-assets';

console.log(`host:   ${new URL(url).host}`);
console.log(`mode:   ${APPLY ? 'APPLY — irreversible' : 'DRY RUN — nothing is written'}\n`);

const sql = postgres(url, { max: 1, prepare: false });

/* ── Who is being removed, and who is being kept ───────────────────────── */

const all = await sql`select location_id, name, slug from schools order by created_at`;
const going = all.filter((s) => targets.includes(s.location_id));
const staying = all.filter((s) => !targets.includes(s.location_id));

const missing = targets.filter((t) => !all.some((s) => s.location_id === t));
if (missing.length > 0) {
  console.error(`no such school: ${missing.join(', ')}`);
  await sql.end();
  process.exit(2);
}
if (staying.length === 0) {
  console.error('refusing: that would remove every school in the database.');
  await sql.end();
  process.exit(2);
}

console.log('REMOVING:');
for (const s of going) console.log(`  ${s.name}  (${s.slug})  ${s.location_id}`);
console.log('\nKEEPING:');
for (const s of staying) console.log(`  ${s.name}  (${s.slug})  ${s.location_id}`);

/* ── Prove the cascade still covers everything ─────────────────────────── */

const NO_CASCADE_BY_DESIGN = ['schools', 'email_outbox'];

const withLocation = (
  await sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'location_id'`
).map((r) => r.table_name);

const cascading = (
  await sql`
    select src.relname as child
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_class tgt on tgt.oid = con.confrelid
    where con.contype = 'f' and tgt.relname = 'schools' and con.confdeltype = 'c'`
).map((r) => r.child);

const uncovered = withLocation.filter(
  (t) => !cascading.includes(t) && !NO_CASCADE_BY_DESIGN.includes(t),
);

console.log(
  `\ncascade cover: ${cascading.length} of ${withLocation.length} location_id tables cascade from schools`,
);
if (uncovered.length > 0) {
  console.error(
    `\nrefusing: these carry location_id but neither cascade nor are handled by hand:\n  ${uncovered.join(
      ', ',
    )}\nAdd them to this script before deleting anything.`,
  );
  await sql.end();
  process.exit(1);
}
console.log(`handled by hand: ${NO_CASCADE_BY_DESIGN.join(', ')}`);

/* ── Count what goes ───────────────────────────────────────────────────── */

let total = 0;
const perTable = [];
for (const table of withLocation) {
  const r = await sql.unsafe(
    `select count(*)::int as n from public."${table}" where location_id = any($1)`,
    [targets],
  );
  if (r[0].n > 0) {
    perTable.push({ table, n: r[0].n });
    total += r[0].n;
  }
}
console.log(`\nrows to delete: ${total} across ${perTable.length} tables`);
for (const r of perTable.sort((a, b) => b.n - a.n).slice(0, 12)) {
  console.log(`  ${String(r.n).padStart(6)}  ${r.table}`);
}
if (perTable.length > 12) console.log(`  … and ${perTable.length - 12} more tables`);

/* ── GoTrue accounts, minus anyone who also belongs elsewhere ──────────── */

const authIds = (
  await sql`
    select distinct auth_user_id from school_users
    where location_id = any(${targets}) and auth_user_id is not null`
).map((r) => r.auth_user_id);

const shared = (
  await sql`
    select distinct auth_user_id from school_users
    where auth_user_id = any(${authIds}) and not (location_id = any(${targets}))`
).map((r) => r.auth_user_id);

const deletableAuth = authIds.filter((id) => !shared.includes(id));
console.log(`\nGoTrue accounts: ${authIds.length} linked, ${shared.length} shared with a kept school (left alone)`);
console.log(`  to delete: ${deletableAuth.length}`);

/* ── Storage objects ───────────────────────────────────────────────────── */

const objects = await sql`
  select name, (metadata->>'size')::bigint as size
  from storage.objects
  where bucket_id = ${bucket} and split_part(name, '/', 1) = any(${targets})`;
const bytes = objects.reduce((a, o) => a + Number(o.size ?? 0), 0);
console.log(`\nStorage: ${objects.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB in "${bucket}"`);

const dbSizeBefore = (await sql`select pg_size_pretty(pg_database_size(current_database())) as s`)[0].s;
console.log(`\ndatabase size now: ${dbSizeBefore}`);

if (!APPLY) {
  console.log('\nDRY RUN — nothing was written. Re-run with --apply --i-have-a-backup.');
  await sql.end();
  process.exit(0);
}

/* ── Apply ─────────────────────────────────────────────────────────────── */

console.log('\napplying…');

// Storage first: if this fails, the tenant is still intact and re-runnable.
if (objects.length > 0) {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: objects.map((o) => o.name) }),
  });
  if (!response.ok) {
    console.error(`storage delete failed: HTTP ${response.status} ${await response.text()}`);
    await sql.end();
    process.exit(1);
  }
  console.log(`  storage: removed ${objects.length} files`);
}

// Then the rows, in one transaction. email_outbox first — nothing cascades to
// it — then the schools row, which unwinds the other 112 tables.
const deleted = await sql.begin(async (tx) => {
  const outbox = await tx`delete from email_outbox where location_id = any(${targets}) returning id`;
  const schools = await tx`delete from schools where location_id = any(${targets}) returning location_id`;
  return { outbox: outbox.length, schools: schools.length };
});
console.log(`  email_outbox: ${deleted.outbox} rows`);
console.log(`  schools: ${deleted.schools} rows (cascaded through 112 tables)`);

// GoTrue accounts last: they are the only part not reachable from `schools`.
let authDeleted = 0;
for (const id of deletableAuth) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (response.ok) authDeleted += 1;
  else console.error(`  auth user ${id}: HTTP ${response.status}`);
}
console.log(`  auth users: ${authDeleted} of ${deletableAuth.length} deleted`);

/* ── Prove it ──────────────────────────────────────────────────────────── */

console.log('\n── proving the tenant is gone ──');
let leftovers = 0;
for (const table of withLocation) {
  const r = await sql.unsafe(
    `select count(*)::int as n from public."${table}" where location_id = any($1)`,
    [targets],
  );
  if (r[0].n > 0) {
    leftovers += r[0].n;
    console.log(`  FAIL  ${table} still holds ${r[0].n} rows`);
  }
}
console.log(leftovers === 0 ? '  PASS  no location_id row remains in any table' : `  FAIL  ${leftovers} rows remain`);

const remaining = await sql`select name from schools order by created_at`;
console.log(`  schools remaining: ${remaining.map((r) => r.name).join(', ')}`);

await sql`vacuum full analyze`.catch(() => console.log('  (VACUUM FULL not permitted; ran nothing)'));
const dbSizeAfter = (await sql`select pg_size_pretty(pg_database_size(current_database())) as s`)[0].s;
console.log(`\ndatabase size: ${dbSizeBefore} -> ${dbSizeAfter}`);

await sql.end();
process.exit(leftovers === 0 ? 0 : 1);
