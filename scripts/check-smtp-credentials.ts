/**
 * The SMTP credential resolution, asserted with no network and no mailbox.
 *
 * ── Why this is worth its own gate ───────────────────────────────────────
 * The bug it guards is the most expensive this deployment has had: a correct
 * password, verified repeatedly by the operator, that authenticated locally and
 * answered `535 5.7.8` in production for six days. Nothing was wrong with the
 * credential. It was being damaged **in transit** — an unquoted `#` in a `.env`
 * line opens a comment and silently discards the rest of the value, and a panel
 * stores wrapping quotes literally. Both are invisible: the panel keeps
 * displaying the whole password, and SMTP's reply is identical either way.
 *
 * TypeScript cannot catch any of this — every one of these values is a
 * `string`. The build cannot either. So the arithmetic that repairs the
 * reversible damage, and refuses to touch anything else, is asserted here.
 *
 *     npm run check-smtp
 *
 * The `must NOT` half matters as much as the repairs. A password may
 * legitimately contain a quote or a `#`, and a "fix" that mangled those would
 * replace a diagnosable failure with an undiagnosable one.
 *
 * No network, no mailbox, no environment: this asserts the pure half only.
 * Whether the live process holds the right password is a different question and
 * only `POST /api/internal/smtp-check` can answer it.
 */

import {
  base64IsMalformed,
  describeSmtpCredentials,
  fragileCharactersIn,
  normalizeSmtpSecret,
  readConfiguredSmtpPass,
} from '../lib/smtp-credentials';

let failures = 0;

function assert(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}`);
  console.log(`       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/*
 * The same shape as the live password: letters, digits, and the three
 * characters that break in transit — `!`, `@` and `#`.
 */
const REAL = 'fooBar!x@y#z';
const B64 = Buffer.from(REAL, 'utf8').toString('base64');

console.log('\nDamage that is provably damage, and is repaired:');

assert('single quotes a panel stored literally', readConfiguredSmtpPass(`'${REAL}'`, undefined), REAL);
assert('double quotes likewise', readConfiguredSmtpPass(`"${REAL}"`, undefined), REAL);
assert('a trailing newline from a panel textarea', readConfiguredSmtpPass(`${REAL}\n`, undefined), REAL);
assert('leading and trailing spaces', readConfiguredSmtpPass(`  ${REAL}  `, undefined), REAL);

console.log('\nThe base64 form, which nothing in the chain can damage:');

assert('decodes verbatim, "#" and all', readConfiguredSmtpPass(undefined, B64), REAL);
assert('wins over a plain value that was truncated at the "#"', readConfiguredSmtpPass('fooBar!x@y', B64), REAL);
assert('surrounding whitespace on the encoded form is tolerated', readConfiguredSmtpPass(undefined, ` ${B64} `), REAL);
assert(
  'malformed base64 falls back rather than disabling mail',
  readConfiguredSmtpPass(REAL, '!!! not base64 !!!'),
  REAL,
);
assert('and malformed base64 is reported', base64IsMalformed('!!! not base64 !!!'), true);
assert('a healthy encoded value is not', base64IsMalformed(B64), false);

console.log('\nWhat it must NOT do — a password may legitimately hold these:');

assert(
  'a value whose quote is data is left alone',
  readConfiguredSmtpPass(`'abc'def'`, undefined),
  `'abc'def'`,
);
assert('an interior "#" is never stripped', readConfiguredSmtpPass(REAL, undefined), REAL);
assert('an unmatched leading quote is kept', normalizeSmtpSecret(`'abc`), `'abc`);
assert('an unmatched trailing quote is kept', normalizeSmtpSecret(`abc'`), `abc'`);
assert('mismatched quote characters are kept', normalizeSmtpSecret(`'abc"`), `'abc"`);
assert('one bare quote is not treated as a pair', normalizeSmtpSecret(`'`), `'`);
assert('an empty value stays empty', normalizeSmtpSecret(''), '');
assert('an unset value stays unset', normalizeSmtpSecret(undefined), undefined);

console.log('\nThe verdict an operator reads at boot:');

assert(
  'plain text carrying fragile characters is refused',
  describeSmtpCredentials('u@example.com', REAL, undefined).ok,
  false,
);
assert(
  'the base64 form reports healthy',
  describeSmtpCredentials('u@example.com', undefined, B64).ok,
  true,
);
assert(
  'a plain password with a safe alphabet is accepted',
  describeSmtpCredentials('u@example.com', 'AbcDef123456', undefined).ok,
  true,
);
assert(
  'a missing password is refused',
  describeSmtpCredentials('u@example.com', undefined, undefined).ok,
  false,
);
assert(
  'a missing user is refused',
  describeSmtpCredentials(undefined, 'AbcDef123456', undefined).ok,
  false,
);
assert(
  'the exact fragile characters are named',
  fragileCharactersIn(REAL).join(''),
  '#!',
);
assert('a safe password names none', fragileCharactersIn('AbcDef123456').length, 0);

if (failures > 0) {
  console.log(`\nFAIL — ${failures} assertion(s) about SMTP credentials did not hold.`);
  process.exitCode = 1;
} else {
  console.log('\nPASS — the credential repair holds, and leaves legitimate values alone.');
  process.exitCode = 0;
}
