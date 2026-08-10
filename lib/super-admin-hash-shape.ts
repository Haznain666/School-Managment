/**
 * Is `SUPER_ADMIN_PASSWORD_HASH` still a bcrypt hash by the time it reaches
 * this process?
 *
 * ── Why this is its own module ───────────────────────────────────────────
 * Three places need the answer: the boot check in `instrumentation.ts`, the
 * refusal log in `lib/super-admin-credentials.ts`, and the host script in
 * `scripts/check-super-admin-env.mjs`. The first two are compiled for the Edge
 * runtime as well as Node, so this file must stay free of `server-only`,
 * bcryptjs and anything else with a runtime dependency — it is string
 * inspection and nothing more.
 *
 * ── What it is inspecting ────────────────────────────────────────────────
 * `compare()` in bcryptjs opens with `if (hash.length !== 60) return false`.
 * A hash damaged in transit therefore never throws: it answers "wrong
 * password", forever, on every attempt. The two ways it gets damaged are
 * mirror images of each other, which is what makes the fix so easy to get
 * backwards:
 *
 *   - `.env.local` is read by `@next/env`, which runs dotenv-expand, so every
 *     `$` must be written `\$`. Correct there, fatal in a panel.
 *   - Hostinger's environment panel does no expansion, so it needs the raw
 *     `$2b$12$…`. Correct there, fatal if something downstream expands it.
 *
 * Both produce an identical, silent 401. This turns that into a sentence.
 */

export interface HashShape {
  /** True only when bcryptjs will really compare this value. */
  ok: boolean;
  /** One sentence naming the damage, or confirming there is none. */
  message: string;
}

/** A bcrypt hash is always exactly this long. */
const BCRYPT_HASH_LENGTH = 60;

export function describeHashShape(hash: string | undefined): HashShape {
  if (hash === undefined || hash.trim() === '') {
    return {
      ok: false,
      message:
        'SUPER_ADMIN_PASSWORD_HASH is not set — Super Admin sign-in returns 500 ' +
        'until it is.',
    };
  }

  if (
    hash.length === BCRYPT_HASH_LENGTH &&
    hash.startsWith('$2') &&
    !hash.includes('\\')
  ) {
    return { ok: true, message: 'SUPER_ADMIN_PASSWORD_HASH is well-formed (60 chars).' };
  }

  // One diagnosis, in the order that identifies the cause rather than the
  // symptom: a backslash explains a wrong length, and a missing prefix
  // explains it differently, so length alone is the last thing to report.
  const cause = hash.includes('\\')
    ? 'it contains backslashes, so the escaped "\\$2b\\$12\\$" form reached this ' +
      'process unexpanded — store the RAW hash in the host panel instead'
    : !hash.startsWith('$2')
      ? 'the "$2b$" prefix is gone, so something expanded "$2b" and "$12" as ' +
        'shell variables — escape them, or single-quote the value'
      : 'something truncated or padded it — re-paste it';

  return {
    ok: false,
    message:
      `SUPER_ADMIN_PASSWORD_HASH IS MALFORMED: ${String(hash.length)} chars, ` +
      `expected ${String(BCRYPT_HASH_LENGTH)}; ${cause}. ` +
      'Every sign-in fails with 401 until this is fixed. See DEPLOYMENT.md §3.',
  };
}
