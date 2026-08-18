#!/usr/bin/env node

/**
 * Turns an SMTP password into the one form that survives every layer between
 * an operator and a running process.
 *
 *   npm run smtp-encode
 *
 * ── Why this script exists ───────────────────────────────────────────────
 * This deployment's mailbox password contains `!`, `@` and `#`, and the `#` is
 * the one that cost it a week. In an unquoted `.env` line a `#` opens a
 * comment, so dotenv silently discards everything after it:
 *
 *     SMTP_PASS=fooBar!x@y#z      ->  "fooBar!x@y"
 *     SMTP_PASS='fooBar!x@y#z'    ->  "fooBar!x@y#z"
 *
 * The hosting panel still displays the whole password, so inspecting it proves
 * nothing, and SMTP answers `535` either way. The mirror-image mistake is
 * copying the quoted form *including its quotes* into a panel, which does no
 * quote stripping and stores two characters the mailbox has never heard of.
 *
 * Base64's alphabet is `A-Z a-z 0-9 + / =`. No `#`, no `$`, no `!`, no quote,
 * no backslash — nothing for dotenv-expand, a shell or a panel to act on. Paste
 * the printed value into `SMTP_PASS_B64` and the whole class of failure is gone.
 *
 * It also prints the fingerprint, so the value the *deployed* process holds can
 * be compared against this one without either side revealing the password.
 * Compare it with `password.fingerprint` from POST /api/internal/smtp-check.
 */

import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });

// Suppress the echo so a pasted secret does not stay on screen.
const wasRaw = process.stdin.isTTY === true;
if (wasRaw) {
  rl.output.write('Paste the SMTP password (input hidden): ');
  rl._writeToOutput = () => {};
} else {
  rl.output.write('Reading password from stdin...\n');
}

rl.question('', (answer) => {
  rl.close();
  if (wasRaw) process.stdout.write('\n');

  // Only the line ending. Everything else is deliberately preserved — a
  // password may legitimately end in a character this script must not judge.
  const value = answer.replace(/\r?\n$/, '');

  if (value === '') {
    console.error('Nothing entered.');
    process.exit(1);
  }

  const encoded = Buffer.from(value, 'utf8').toString('base64');
  const fingerprint = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);

  const fragile = ['#', '$', '!', '"', "'", '\\', '`'].filter((c) => value.includes(c));

  console.log('');
  console.log('  length      :', value.length);
  console.log('  fingerprint :', fingerprint);
  console.log(
    '  fragile     :',
    fragile.length === 0
      ? 'none — this password would survive as plain text too'
      : `${fragile.map((c) => JSON.stringify(c)).join(' ')}  <- why plain text fails`,
  );

  if (value !== value.trim()) {
    console.log('  WARNING     : it has leading or trailing whitespace, which is');
    console.log('                almost always a paste artifact. Check it.');
  }

  console.log('');
  console.log('  Set THIS in the Hostinger panel (and remove SMTP_PASS):');
  console.log('');
  console.log(`    SMTP_PASS_B64=${encoded}`);
  console.log('');
  console.log('  Then restart the app. Confirm the live process agrees:');
  console.log('    POST /api/internal/smtp-check   ->  password.fingerprint');
  console.log(`    should read ${fingerprint}`);
  console.log('');
});
