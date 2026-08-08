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
 * ── It prints the whole line, already escaped ────────────────────────────
 * A bcrypt hash is full of `$`, and `.env.local` is read by `@next/env`,
 * which runs dotenv-expand over it — so an unescaped `$2b` would be treated
 * as a variable reference and silently eaten. The output below is the
 * complete, correctly escaped line, ready to replace the existing one. Do not
 * retype it by hand.
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

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    let muted = false;

    // readline has no "hide input" option, so the write hook is replaced and
    // everything after the prompt is swallowed.
    rl._writeToOutput = (chunk) => {
      if (!muted || chunk.includes(question)) {
        process.stdout.write(chunk);
      }
    };

    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });

    muted = true;
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

console.log('\nReplace the SUPER_ADMIN_PASSWORD_HASH line in .env.local with:\n');
console.log(`SUPER_ADMIN_PASSWORD_HASH="${hash.replaceAll('$', '\\$')}"`);
console.log(
  '\nRestart the dev server afterwards — .env.local is read at start, not ' +
    'per request.',
);
