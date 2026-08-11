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

/**
 * Repairs the two kinds of transport damage that are provably damage.
 *
 * ── Why repairing is safe, and not a guess ───────────────────────────────
 * A bcrypt hash draws from a fixed alphabet: `$`, `.`, `/`, `A-Z`, `a-z` and
 * `0-9`. A backslash and a surrounding quote are therefore not merely unlikely
 * in that value — they are impossible. When one appears it can only have been
 * added in transit, so removing it cannot corrupt a legitimate hash. It can
 * only restore a damaged one.
 *
 * ── Why this exists at all ───────────────────────────────────────────────
 * The escaped `\$2b\$12\$…` form is correct in a `.env` file, because
 * `@next/env` runs dotenv-expand over it, and fatal in a hosting panel, which
 * does no expansion. Operators cannot be expected to know which side of that
 * line their host sits on — and on Hostinger the panel and the `.env` file
 * turned out to be one store, so the answer is not even stable per host.
 * Deployments spent days on this, because bcryptjs answers "wrong password"
 * rather than raising, so the damage is invisible.
 *
 * Normalising on read ends the whole class of failure: whichever form is
 * stored, the process compares against the same 60 characters.
 *
 * The unexpanded case — where something ate `$2b` and `$12` as shell
 * variables — is deliberately NOT repaired. Those characters are gone, not
 * hidden, and inventing them would be a guess. It stays a loud error.
 */
export function normalizeBcryptHash(hash: string | undefined): string | undefined {
  if (hash === undefined) return undefined;

  let value = hash.trim();

  // One matching pair of wrapping quotes, which a panel or a shell may add.
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      value = value.slice(1, -1);
    }
  }

  // Backslashes that escape a `$`. Nothing else is touched, so a value damaged
  // in some way this does not understand still reaches the shape check intact
  // and is reported rather than silently mangled further.
  return value.replace(/\\(?=\$)/g, '');
}

export function describeHashShape(rawHash: string | undefined): HashShape {
  const hash = normalizeBcryptHash(rawHash);
  const wasRepaired = rawHash !== undefined && hash !== rawHash;

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
    // A repaired hash works, but the stored value is still wrong and the next
    // person to read it will be misled. Say so once per boot rather than
    // letting a silent fix hide the misconfiguration forever.
    return {
      ok: true,
      message: wasRepaired
        ? 'SUPER_ADMIN_PASSWORD_HASH arrived escaped or quoted and was repaired ' +
          'on read (60 chars after repair). Sign-in works, but store the RAW ' +
          '"$2b$12$..." form to remove the ambiguity.'
        : 'SUPER_ADMIN_PASSWORD_HASH is well-formed (60 chars).',
    };
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
