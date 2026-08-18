/**
 * Does the SMTP password still say what the mailbox says by the time it
 * reaches this process?
 *
 * ── The fault this module exists to end ──────────────────────────────────
 * Production answered `535 5.7.8 authentication failed` on every message from
 * 2026-08-13 onward while the very same credentials, typed into `.env.local`,
 * authenticated against `smtp.titan.email` on the first attempt. Earlier
 * sessions read that as "the panel's copy is wrong" and told the operator to
 * re-paste it. The operator re-pasted it, correctly, more than once, and
 * nothing changed — because the credential was never the problem. Its
 * **transport** was.
 *
 * This deployment's password contains `!`, `@` and `#`. That `#` is the whole
 * story:
 *
 *     SMTP_PASS=fooBar!x@y#z      ->  dotenv yields "fooBar!x@y"
 *     SMTP_PASS='fooBar!x@y#z'    ->  dotenv yields "fooBar!x@y#z"
 *
 * In a `.env` file an unquoted `#` opens a comment, so **everything from the
 * `#` onward is silently discarded**. Measured against this repository's own
 * `@next/env`, not assumed. `.env.local` survives only because an earlier
 * session happened to wrap the value in single quotes; anywhere the same value
 * is written unquoted — a hosting panel that materialises its variables into a
 * `.env`, a shell export, a CI secret rendered into a file — the process
 * receives a truncated password and the mailbox rejects it. The panel still
 * *displays* the full value, which is why inspecting it proves nothing.
 *
 * The mirror-image failure is just as quiet: an operator who copies the working
 * `'fooBar!x@y#z'` **including its quotes** into a panel, which does no quote
 * stripping, stores two characters the mailbox has never heard of.
 *
 * Both produce an identical, silent 535. This module turns that into a
 * sentence, repairs the damage that is reversible, and offers a form
 * (`SMTP_PASS_B64`) that no layer in the chain can damage at all.
 *
 * ── Deliberately dependency-free ─────────────────────────────────────────
 * String inspection and nothing more, so `instrumentation.ts` — which is
 * compiled for the Edge runtime as well as Node — can report at boot without
 * dragging nodemailer into a bundle that cannot hold it.
 */

/**
 * Characters that no layer between an operator and this process agrees about.
 *
 * `#` opens a comment in an unquoted `.env` line. `$` is a variable reference
 * to dotenv-expand and to every shell. `!` is history expansion in an
 * interactive bash. Quotes and backslashes are stripped, added or escaped by
 * whichever of those ran last. A password containing any of them is not wrong
 * — it is simply not safely transportable as plain text, and the fix is to
 * stop transporting it as plain text.
 */
const FRAGILE_CHARACTERS = ['#', '$', '!', '"', "'", '\\', '`'] as const;

export interface SmtpCredentialShape {
  /** False only when something is provably wrong or provably missing. */
  ok: boolean;
  /** One sentence naming the damage, or confirming there is none. */
  message: string;
}

/**
 * Removes transport damage that is provably damage, and nothing else.
 *
 * ── Why each repair is safe ──────────────────────────────────────────────
 * **Surrounding whitespace.** A leading or trailing space, tab or newline in a
 * mailbox password is never deliberate and is the single most common paste
 * artifact — a panel textarea that adds a newline, a copied line from a config
 * file. SMTP AUTH offers no way to tell "password " from "password" other than
 * failing, so preserving it can only ever lose.
 *
 * **One matching pair of wrapping quotes.** This needs more care than the
 * bcrypt equivalent, because unlike a hash a password *may* legitimately
 * contain a quote. So the pair is stripped only when it wraps the whole value
 * and the same character does not also appear inside it: `'abc'` is repaired,
 * while `'abc'def'` is left exactly as it is, because there the outer marks
 * could plausibly be data. When in doubt this does nothing and lets the shape
 * report say so.
 *
 * What is NOT repaired is truncation at a `#`, because it cannot be: those
 * bytes are gone, not hidden, and inventing them would be a guess. It stays a
 * loud warning, and `SMTP_PASS_B64` is the way out.
 */
export function normalizeSmtpSecret(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;

  const value = raw.trim();
  if (value.length < 2) return value;

  const first = value[0];
  const last = value[value.length - 1];

  if ((first === '"' || first === "'") && first === last) {
    const inner = value.slice(1, -1);
    // Only when the quote character is not also part of the value itself.
    if (!inner.includes(first)) return inner;
  }

  return value;
}

/**
 * The password this process should use, from either of the two ways to supply
 * it.
 *
 * ── Why a base64 form exists ─────────────────────────────────────────────
 * Because the plain one cannot be made reliably transportable, for exactly the
 * reason `SUPER_ADMIN_PASSWORD_HASH_B64` exists beside it: the correct way to
 * write a value depends on machinery the operator cannot see. Quote it and a
 * panel stores the quotes. Leave it bare and a `.env` writer eats everything
 * after the `#`. Escape the `$` and a panel that does no expansion keeps the
 * backslash. There is no single form that is right everywhere, so the answer is
 * an alphabet that has nothing for any of those layers to act on.
 *
 * Base64's alphabet is `A-Z a-z 0-9 + / =`. No `#`, no `$`, no `!`, no quote,
 * no backslash. It survives every mechanism that has broken this deployment,
 * and it is the form that should be set in the Hostinger panel.
 *
 * `SMTP_PASS_B64` wins when both are set, because an operator who has just
 * added it is trying to fix precisely this.
 */
export function readConfiguredSmtpPass(
  raw: string | undefined,
  base64: string | undefined,
): string | undefined {
  const encoded = base64?.trim();

  if (encoded !== undefined && encoded !== '') {
    try {
      // `atob` is a global in both runtimes, which keeps this module free of
      // `node:buffer` and therefore safe for the Edge compilation.
      const decoded = atob(encoded);
      // Only transport whitespace is stripped. The decoded bytes are whatever
      // the operator encoded, and a `#` or a quote inside them is data that
      // arrived intact — which is the entire point of the form.
      const trimmed = decoded.trim();
      if (trimmed !== '') return trimmed;
    } catch {
      // Not valid base64. Fall through to the plain variable rather than
      // failing outright: a typo here must not disable a deployment whose
      // plain password is still correct. The shape report names it.
    }
  }

  return normalizeSmtpSecret(raw);
}

/** True when the base64 form is set but is not decodable. */
export function base64IsMalformed(base64: string | undefined): boolean {
  const encoded = base64?.trim();
  if (encoded === undefined || encoded === '') return false;

  try {
    return atob(encoded).trim() === '';
  } catch {
    return true;
  }
}

/** Which fragile characters a value contains, for an operator-facing warning. */
export function fragileCharactersIn(value: string): string[] {
  return FRAGILE_CHARACTERS.filter((character) => value.includes(character));
}

/**
 * One sentence on whether this process can be expected to authenticate.
 *
 * Reported at boot rather than left to the first send, for the same reason the
 * Super Admin hash is: a 535 arrives inside a queue drain, thirty seconds after
 * whoever pressed the button has moved on, and reads identically whether the
 * password is wrong, truncated or quoted.
 */
export function describeSmtpCredentials(
  rawUser: string | undefined,
  rawPass: string | undefined,
  rawPassB64: string | undefined,
): SmtpCredentialShape {
  const usingBase64 = rawPassB64 !== undefined && rawPassB64.trim() !== '';

  if (base64IsMalformed(rawPassB64)) {
    return {
      ok: false,
      message:
        'SMTP_PASS_B64 is set but is not valid base64, so it was ignored and ' +
        'SMTP_PASS was used instead. Regenerate it with: npm run smtp-encode',
    };
  }

  const user = normalizeSmtpSecret(rawUser);
  const pass = readConfiguredSmtpPass(rawPass, rawPassB64);

  if (pass === undefined || pass === '') {
    return {
      ok: false,
      message:
        'SMTP_PASS is not set, so every outbound message will fail ' +
        'authentication. Set SMTP_PASS_B64 in the host panel.',
    };
  }

  if (user === undefined || user === '') {
    return {
      ok: false,
      message: 'SMTP_USER is not set, so authentication has no account to offer.',
    };
  }

  if (usingBase64) {
    return {
      ok: true,
      message:
        `SMTP_PASS_B64 decoded cleanly (${String(pass.length)} chars). ` +
        'This is the transport-safe form.',
    };
  }

  const fragile = fragileCharactersIn(pass);

  if (fragile.length > 0) {
    return {
      ok: false,
      message:
        `SMTP_PASS is set as plain text and contains ${fragile
          .map((character) => `"${character}"`)
          .join(', ')} — characters that dotenv, a shell and a hosting panel each ` +
        'rewrite differently. An unquoted "#" in a .env line silently truncates the ' +
        'value at that point, which is exactly how a correct password produces 535 in ' +
        'production while working locally. Set SMTP_PASS_B64 instead and remove ' +
        'SMTP_PASS. Generate it with: npm run smtp-encode',
    };
  }

  const passWasRepaired = rawPass !== undefined && pass !== rawPass;
  const userWasRepaired = rawUser !== undefined && user !== rawUser;

  if (passWasRepaired || userWasRepaired) {
    return {
      ok: true,
      message:
        'SMTP credentials arrived quoted or padded and were repaired on read. ' +
        'Authentication should work, but the stored value is still wrong and will ' +
        'mislead the next person to read it — prefer SMTP_PASS_B64.',
    };
  }

  return {
    ok: true,
    message: `SMTP credentials look transportable (password ${String(pass.length)} chars).`,
  };
}
