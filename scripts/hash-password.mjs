/**
 * Generates the bcrypt hash for `SUPER_ADMIN_PASSWORD_HASH`.
 *
 *   npm run hash-password
 *
 * ── Why this is a script and not a one-liner ─────────────────────────────
 * `.env.example` used to carry a `node -e "…" 'your-password'` incantation.
 * It had two faults, and both bit:
 *
 *   1. It only works from the project root, because that is where `bcryptjs`
 *      is installed. Run anywhere else — a shell that opens at `C:\`, say —
 *      and it dies with MODULE_NOT_FOUND, which reads like a broken install
 *      rather than a wrong directory.
 *   2. The password is an argument, so it is written verbatim into shell
 *      history (`ConsoleHost_history.txt` on Windows) and is visible in the
 *      process list while it runs. Rotating a leaked password by leaking it
 *      again is not much of a rotation.
 *
 * This prompts instead: nothing reaches argv, history, or the terminal.
 *
 * ── It prints two forms, and says which goes where ───────────────────────
 * A bcrypt hash is full of `$`. `.env.local` is read by `@next/env`, which
 * runs dotenv-expand, so there every `$` must be written `\$` or `$2b` is
 * treated as a variable reference and silently eaten. A hosting panel does no
 * expansion, so there the same backslashes are literal characters that make
 * the value 63 long instead of 60 — and bcryptjs rejects any length but 60 by
 * returning false, never by raising.
 *
 * The two destinations therefore need exactly opposite strings, and for a long
 * time this script printed only the `.env.local` one, unlabelled. See the
 * comment above the output below for what that cost.
 */
import { createInterface } from 'node:readline';

import bcrypt from 'bcryptjs';

/** bcrypt cost. 12 is the value the existing hash was generated with. */
const COST = 12;
const MIN_LENGTH = 12;

/** Reads a line without echoing it. */
function askSecret(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      // Piped input: read it straight through, so the script still works in a
      // context with no terminal.
      let buffered = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        buffered += chunk;
      });
      process.stdin.on('end', () => {
        resolve(buffered.trim());
      });
      process.stdin.on('error', reject);
      return;
    }

    // The prompt is written here, before readline exists, so that readline's
    // output can be suppressed *unconditionally* below.
    //
    // The usual version of this trick lets through any chunk containing the
    // prompt text, and that leaks: in terminal mode readline redraws the whole
    // line on every keypress, prompt and typed characters together, so the
    // password appears one character at a time. Printing the prompt ourselves
    // and then muting everything has no such hole — the worst it can do is
    // show nothing.
    process.stdout.write(question);

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    rl._writeToOutput = () => {};

    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = await askSecret('New Super Admin password: ');

if (password.length < MIN_LENGTH) {
  console.error(
    `\nToo short — use at least ${MIN_LENGTH} characters. This is the ` +
      'credential for every tenant on the platform.',
  );
  process.exit(1);
}

const hash = bcrypt.hashSync(password, COST);

/**
 * Two forms, because there are two destinations and they need opposite things.
 *
 * This script used to print only the escaped one, with no indication that it
 * was escaped or that anywhere wanted it otherwise. Copying its output into a
 * hosting panel — the obvious thing to do with a line labelled "the
 * SUPER_ADMIN_PASSWORD_HASH line" — stored 63 characters and three
 * backslashes. `compare()` in bcryptjs returns false for anything that is not
 * 60 characters, without raising an error, so the deployment answered "wrong
 * password" to a correct password with nothing in any log. That cost four
 * sessions across 2026-08-10 and 2026-08-11, and the backslashes were printed
 * right here.
 */
const escaped = hash.replaceAll('$', '\\$');

console.log('\n' + '='.repeat(68));
console.log('TWO forms. They are NOT interchangeable — copy the right one.');
console.log('='.repeat(68));

console.log('\n1. For a HOSTING PANEL (Hostinger, Vercel, Docker, systemd) —');
console.log('   paste ONLY the value, exactly as shown. No quotes, no backslashes:\n');
console.log(`   ${hash}`);
console.log(`\n   (${String(hash.length)} characters — a bcrypt hash is always exactly 60.)`);

console.log('\n2. For `.env.local` on your own machine — replace the whole line.');
console.log('   The backslashes are required ONLY here, because @next/env runs');
console.log('   dotenv-expand and would otherwise eat "$2b" and "$12":\n');
console.log(`   SUPER_ADMIN_PASSWORD_HASH="${escaped}"`);
console.log(
  `\n   (${String(escaped.length)} characters as written; it resolves back to ${String(hash.length)}.)`,
);

console.log('\n' + '-'.repeat(68));
console.log('If a panel ever holds a value with backslashes, or one that is not');
console.log('60 characters, every sign-in returns 401 with nothing in the log.');
console.log('Verify what the deployed process actually received with:');
console.log('  POST /api/internal/super-admin-check   (see DEPLOYMENT.md §3)');
console.log(
  '\nRestart afterwards — the environment is read at start, not per request.',
);
