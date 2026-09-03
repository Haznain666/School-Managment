/**
 * Mints a platform emergency-login link so a QA session can sign in as a
 * school member **without anybody typing a password**.
 *
 *   node scripts/qa-emergency-link.mjs <school-slug> <email>
 *
 * ── Why this exists, rather than a minted password hash ──────────────────
 * Every previous QA round signed in by writing a throwaway
 * `SUPER_ADMIN_PASSWORD_HASH_B64` into `.env.local`, signing in as the
 * platform operator and using *Login as Admin*. That works, but it writes a
 * real credential into a real file, and restoring that file byte-identical
 * afterwards has already cost one session an hour: appending with `cat >>`
 * glues onto `SMTP_PORT=465`, because the file has no trailing newline, and
 * the only symptom is "Incorrect email or password" (STATE.md §5bl).
 *
 * `emergency_login_tokens` is the product's own answer to "sign this person in
 * without delivering a passcode", and it is the most constrained credential in
 * the system: fifteen minutes, single use, bound to one member at one school,
 * `used_at` stamped *before* the session is minted so a leaked link is inert,
 * and the row is kept rather than deleted so the issuance is auditable. Using
 * it here means QA borrows a mechanism that is already reviewed, already
 * expiring and already recorded — and `.env.local` is never touched.
 *
 * ── It is deliberately not a login-as-anybody tool ───────────────────────
 * The member must already exist and be active at the named school. This mints
 * nothing, creates no account and grants no permission: it opens a session for
 * a person the school already has, exactly as the Super Admin panel's own
 * emergency-link button does.
 */
import { randomBytes } from 'node:crypto';

// `@next/env` is CommonJS; Node 24 refuses the named import.
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const postgres = (await import('postgres')).default;

const [slug, email] = process.argv.slice(2);

if (slug === undefined || email === undefined) {
  console.error('Usage: node scripts/qa-emergency-link.mjs <school-slug> <email>');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (url === undefined || url === '') {
  console.error('DATABASE_URL is not set. Run from the repo root with .env.local present.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

try {
  const schools = await sql`
    select location_id, name, slug
      from schools
     where slug = ${slug}
     limit 1
  `;

  const school = schools[0];
  if (school === undefined) {
    const available = await sql`select slug from schools order by slug`;
    console.error(`No school with slug "${slug}".`);
    console.error(`Available: ${available.map((row) => row.slug).join(', ')}`);
    process.exit(1);
  }

  const members = await sql`
    select id, name, role, is_active, email
      from school_users
     where location_id = ${school.location_id}
       and lower(email) = lower(${email})
     limit 1
  `;

  const member = members[0];
  if (member === undefined) {
    console.error(`No member with address "${email}" at ${school.name}.`);
    const roster = await sql`
      select email, role
        from school_users
       where location_id = ${school.location_id}
         and is_active = true
         and email is not null
       order by role, email
    `;
    console.error('Active members with an address:');
    for (const row of roster) console.error(`  ${row.role.padEnd(16)} ${row.email}`);
    process.exit(1);
  }

  // The route refuses an inactive account by design; say so here rather than
  // hand back a link that will fail with a message about the link.
  if (!member.is_active) {
    console.error(`"${email}" exists at ${school.name} but is not active.`);
    process.exit(1);
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await sql`
    insert into emergency_login_tokens
      (location_id, school_user_id, auth_user_id, token, expires_at)
    values
      (${school.location_id}, ${member.id}, null, ${token}, ${expiresAt})
  `;

  const base = process.env.QA_BASE_URL ?? 'http://localhost:3000';

  console.log('');
  console.log(`  School   ${school.name}  (${school.slug})`);
  console.log(`  Member   ${member.name} — ${member.role} — ${member.email}`);
  console.log(`  Expires  ${expiresAt.toISOString()}  (15 minutes, single use)`);
  console.log('');
  console.log('  Navigate to this once. It signs the browser in and is then spent:');
  console.log('');
  console.log(`  ${base}/api/school/emergency-login/${token}?school=${school.slug}`);
  console.log('');
} finally {
  await sql.end({ timeout: 5 });
}
