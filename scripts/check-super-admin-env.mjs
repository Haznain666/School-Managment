#!/usr/bin/env node

/**
 * Answers one question, on the host, in one command: what does the running
 * process actually see in the Super Admin variables?
 *
 * ── Why this is a script and not a diagnostics route ─────────────────────
 * The existing diagnostics endpoints are guarded by the Super Admin cookie,
 * which is exactly what you cannot get when sign-in is the thing that is
 * broken. This runs beside `server.js` with the same environment and needs no
 * session.
 *
 * ── What it is diagnosing ────────────────────────────────────────────────
 * `compare()` in bcryptjs begins `if (hash.length !== 60) return false`. So a
 * hash damaged on its way into the environment — dotenv-expand eating the
 * `$2b` and `$12` segments, or the `\$2b\$12\$` escaping that `.env.local`
 * requires being pasted into a panel that does no expansion — does not throw.
 * It quietly answers "wrong password" and logs nothing. Everything below is
 * aimed at that failure.
 *
 * Run it from the deployed directory, the same way the app is started:
 *
 *   node scripts/check-super-admin-env.mjs
 *
 * Optionally pass the password to confirm the hash truly matches it:
 *
 *   node scripts/check-super-admin-env.mjs 'your-password'
 *
 * Nothing secret is printed: hashes and secrets appear only as a length and a
 * prefix. Pass the password as a quoted argument and remember it lands in the
 * shell history — clear it afterwards, or omit it and rely on the shape checks.
 */

import { compare } from 'bcryptjs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = [
  'SUPER_ADMIN_EMAIL',
  'SUPER_ADMIN_PASSWORD_HASH',
  'SUPER_ADMIN_JWT_SECRET',
];

let problems = 0;

function fail(message) {
  problems += 1;
  console.log(`  ✗ ${message}`);
}

function pass(message) {
  console.log(`  ✓ ${message}`);
}

console.log('\nSuper Admin environment, as this process sees it');
console.log('='.repeat(60));

// -- 1. Presence -------------------------------------------------------------
console.log('\n1. Are the variables present?');
for (const name of REQUIRED) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    fail(`${name} is missing or empty — sign-in returns 500, not 401.`);
  } else {
    pass(`${name} is set (${String(value.length)} chars)`);
  }
}

// -- 2. The hash's shape -----------------------------------------------------
console.log('\n2. Is SUPER_ADMIN_PASSWORD_HASH intact?');
const hash = process.env.SUPER_ADMIN_PASSWORD_HASH ?? '';

if (hash === '') {
  fail('Nothing to check.');
} else {
  console.log(`  Length: ${String(hash.length)} (a bcrypt hash is exactly 60)`);
  console.log(`  Starts: ${JSON.stringify(hash.slice(0, 7))} (expected "$2a$", "$2b$" or "$2y$" then a cost)`);

  // One diagnosis, not a pile of symptoms: a mangled hash trips several of
  // these checks at once, and three lines describing one fault read as three
  // faults. The first branch that explains the damage is the only one printed.
  if (hash.length === 60 && hash.startsWith('$2') && !hash.includes('\\')) {
    pass('Length is 60 and the prefix survived — bcryptjs will really compare it.');
  } else if (hash.includes('\\')) {
    fail(
      'Contains literal backslashes: this is the escaped `\\$2b\\$12\\$` form that ' +
        '`.env.local` needs. Nothing is expanding it here, so store the RAW hash ' +
        '(starting `$2b$12$`) in the panel instead.',
    );
  } else if (!hash.startsWith('$2')) {
    fail(
      'The `$2b$` prefix is gone: a shell or dotenv-expand read `$2b` and `$12` as ' +
        'variables and replaced them with nothing. Store the ESCAPED ' +
        '`\\$2b\\$12\\$...` form here, or single-quote the value.',
    );
  } else if (hash.startsWith('"') || hash.endsWith('"') || hash.endsWith("'")) {
    fail('Wrapped in quotes — the panel stored the quotes as part of the value.');
  } else if (hash.trim() !== hash) {
    fail('Has surrounding whitespace or a trailing newline. Re-paste it.');
  } else {
    fail(
      `Is ${String(hash.length)} characters, not 60. bcryptjs returns false for any ` +
        'other length without raising an error — which is the silent 401. Re-paste it.',
    );
  }
}

// -- 3. The email ------------------------------------------------------------
console.log('\n3. SUPER_ADMIN_EMAIL');
const email = process.env.SUPER_ADMIN_EMAIL ?? '';
if (email !== '') {
  console.log(`  Compared as: ${JSON.stringify(email.trim().toLowerCase())}`);
  if (email !== email.trim()) {
    console.log('  (leading/trailing whitespace is trimmed before comparison — fine)');
  }
  console.log('  Type the address above into the login form exactly.');
}

// -- 4. Stray .env files -----------------------------------------------------
console.log('\n4. Is a committed .env file overriding the panel?');
console.log('   Next loads these at server start and they WIN over panel values.');
// Exactly the names Next loads, and no others. `.env.example` is checked into
// the repo, holds no values, and is never read — flagging it sends whoever is
// debugging off to delete the documentation.
const LOADED_BY_NEXT = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
  '.env.development',
  '.env.development.local',
]);

try {
  const strays = readdirSync(process.cwd()).filter((name) => LOADED_BY_NEXT.has(name));

  if (strays.length === 0) {
    pass('No .env files beside the server. The panel is the only source.');
  } else {
    for (const name of strays) {
      const { size } = statSync(join(process.cwd(), name));
      fail(`${name} exists (${String(size)} bytes) — delete it and restart.`);
    }
  }
} catch (error) {
  console.log(`  ? Could not read the directory: ${String(error)}`);
}

// -- 5. The real comparison --------------------------------------------------
const candidate = process.argv[2];
if (candidate !== undefined && candidate !== '' && hash.length > 0) {
  console.log('\n5. Does the password actually match this hash?');
  try {
    const matches = await compare(candidate, hash);
    if (matches) {
      pass('It matches. The credentials are correct; the 401 is coming from elsewhere.');
    } else {
      fail('It does not match — this is precisely the 401 you are seeing.');
    }
  } catch (error) {
    fail(`bcrypt threw: ${String(error)}`);
  }
} else {
  console.log('\n5. Password check skipped. Re-run with the password quoted as an argument');
  console.log("   to confirm the match:  node scripts/check-super-admin-env.mjs 'the-password'");
}

console.log('\n' + '='.repeat(60));
console.log(
  problems === 0
    ? 'No problems found in the Super Admin environment.\n'
    : `${String(problems)} problem(s) found — each one above returns 401 with nothing in the log.\n`,
);

process.exit(problems === 0 ? 0 : 1);
