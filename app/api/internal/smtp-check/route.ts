import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { safeEqual } from '@/lib/crypto';
import { resolveSmtpCredentials, verifySmtp } from '@/lib/email-sender';
import { serverEnv } from '@/lib/env';
import {
  base64IsMalformed,
  describeSmtpCredentials,
  fragileCharactersIn,
} from '@/lib/smtp-credentials';

/**
 * POST /api/internal/smtp-check — why does the *deployed* process get 535?
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Sibling of `/api/internal/super-admin-check`, built for the same reason and
 * after the same kind of week. Outbound mail failed in production with
 * `535 5.7.8 authentication failed` on every message from 2026-08-13 onward,
 * while the identical credentials authenticated locally on the first attempt.
 * Every tool available for diagnosing it ran somewhere other than the process
 * serving the request — a dev server, an SSH session with its own environment,
 * a hosting panel that renders a *stored* value rather than a delivered one —
 * and none of them can prove anything about production. Treating them as if
 * they could is what kept the fault alive across three sessions and produced
 * the false conclusion that the mailbox password was wrong. It was not.
 *
 * This runs inside the deployed process. It reports what that process holds,
 * which instance answered, and — on request — the SMTP server's own reply to a
 * real AUTH. It is the only honest answer to "are the credentials that reach
 * production the ones I entered".
 *
 * ── Why these particular facts are safe to expose ────────────────────────
 * Nothing here can reconstruct the password:
 *
 *   - It is described, never returned: its length, a **fingerprint** (first 12
 *     hex of SHA-256, 48 bits), and which transport-fragile characters it
 *     contains. A fingerprint proves two values are identical without
 *     revealing either, which is exactly the question — "is the panel's value
 *     the one the process has?". Compute the same one with `npm run
 *     smtp-encode` and compare by eye.
 *   - `SMTP_USER`, `SMTP_HOST` and `SMTP_FROM` are returned in full. They are
 *     an address and a hostname, not secrets, and comparing them is the point.
 *   - `verify()` returns a boolean and the server's error text. No credential
 *     appears in either.
 *
 * ── Why it is guarded the way it is ──────────────────────────────────────
 * It reveals whether a credential is accepted, and it can be made to open
 * connections to a third party, so it reuses `SUPER_ADMIN_DIAGNOSTICS_SECRET`
 * — compared in constant time, refusing everything while unset, which is its
 * correct resting state. The secret travels in a header, never a query string,
 * so it stays out of access logs and referrers.
 *
 * **Unset the variable once mail is flowing.** This is an instrument, not a
 * feature.
 */

// Reads the live process and opens a socket. Never prerender: the entire value
// of this route is that it answers from the deployment at request time.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SECRET_HEADER = 'x-diagnostics-secret';

/** Files `@next/env` loads at startup, which fill gaps the panel left. */
const ENV_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
] as const;

interface CheckBody {
  /** When true, opens a connection and authenticates. Sends nothing. */
  verify?: unknown;
  /** Optional. Compared by fingerprint only; never stored, never logged. */
  password?: unknown;
}

/**
 * A stable handle for a value, revealing nothing about it.
 *
 * Twelve hex characters is 48 bits: ample to confirm two values match, far too
 * little to attack, and short enough to compare by eye across a terminal and a
 * browser.
 */
function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

export async function POST(request: NextRequest) {
  try {
    // Trimmed, because HTTP strips leading and trailing whitespace from header
    // values in transit — a panel entry with a stray newline could otherwise
    // never be matched, locking the endpoint out while still answering 401.
    const expected = serverEnv('SUPER_ADMIN_DIAGNOSTICS_SECRET', '').trim();

    if (expected === '') {
      return apiFailure(
        'not_configured',
        'SUPER_ADMIN_DIAGNOSTICS_SECRET is not set, so this endpoint is disabled.',
        503,
      );
    }

    if (!safeEqual(request.headers.get(SECRET_HEADER) ?? '', expected)) {
      return apiFailure('unauthorized', 'Not authorised.', 401);
    }

    const body = await readJsonBody<CheckBody>(request);

    // -- What this process holds -------------------------------------------
    const rawUser = process.env.SMTP_USER;
    const rawPass = process.env.SMTP_PASS;
    const rawPassB64 = process.env.SMTP_PASS_B64;

    // Resolved exactly as `sendEmail` resolves it. A diagnostic that reads a
    // different variable than the transport would confirm a password nobody
    // sends with.
    const { user, pass } = resolveSmtpCredentials();
    const shape = describeSmtpCredentials(rawUser, rawPass, rawPassB64);
    const usingBase64 = rawPassB64 !== undefined && rawPassB64.trim() !== '';

    // -- Which process is answering ----------------------------------------
    // More than one Node process has been observed behind this proxy, and they
    // need not hold the same environment. Call twice: a differing pid proves
    // it, and proves that a single green check means nothing.
    const process_ = {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      nodeEnv: process.env.NODE_ENV ?? '(unset)',
      cwd: process.cwd(),
      hostname: request.headers.get('host') ?? '(none)',
    };

    // -- The live answer, if asked for -------------------------------------
    let authAccepted: boolean | null = null;
    let authError: string | null = null;

    if (body?.verify === true) {
      try {
        await verifySmtp();
        authAccepted = true;
      } catch (error) {
        authAccepted = false;
        // The SMTP server's own words. `535 5.7.8` means the credentials were
        // read and rejected; a timeout or `ENOTFOUND` means they were never
        // offered, which is a completely different problem and must not be
        // reported as an authentication failure.
        authError = error instanceof Error ? error.message : String(error);
      }
    }

    // -- Does the panel's value match this process's? ----------------------
    let submittedMatches: boolean | null = null;
    const submitted = typeof body?.password === 'string' ? body.password : null;
    if (submitted !== null) submittedMatches = fingerprint(submitted) === fingerprint(pass);

    return apiSuccess({
      process: process_,

      verdict: {
        ok: shape.ok,
        message: shape.message,
      },

      server: {
        host: serverEnv('SMTP_HOST', '') || null,
        port: serverEnv('SMTP_PORT', '587'),
        // 465 is implicit TLS, 587 STARTTLS. Reported because a mismatch here
        // presents as a hang or a socket close, never as a clear error.
        secure: serverEnv('SMTP_PORT', '587') === '465',
        from: serverEnv('SMTP_FROM', '') || null,
      },

      user: {
        // Not a secret, and comparing it with the mailbox is the point.
        value: user || null,
        length: user.length,
        hadSurroundingWhitespace: rawUser !== undefined && rawUser !== rawUser.trim(),
        repairedOnRead: rawUser !== undefined && user !== rawUser,
      },

      password: {
        present: pass !== '',
        // What the transport will actually offer at AUTH.
        length: pass.length,
        fingerprint: pass === '' ? null : fingerprint(pass),

        // Which variable it came from, and whether the other one is damaged.
        usingBase64,
        base64Malformed: base64IsMalformed(rawPassB64),

        // The raw value, described. When these differ from the effective ones
        // above, the stored value was damaged in transit and repaired on read
        // — which means the panel still needs correcting even if mail now
        // flows.
        rawLength: rawPass?.length ?? 0,
        rawFingerprint: rawPass === undefined ? null : fingerprint(rawPass),
        repairedOnRead: !usingBase64 && rawPass !== undefined && pass !== rawPass,

        /*
         * The characters that make a plain-text password untransportable.
         *
         * A `#` here is the single most likely explanation for a 535 on a
         * password the operator has verified: unquoted in a `.env` line it
         * opens a comment and everything after it is discarded, silently, with
         * the panel still showing the whole thing.
         */
        fragileCharacters: fragileCharactersIn(pass),

        /*
         * Whether a candidate supplied in the body is the one this process
         * holds — compared by fingerprint, so neither side reveals anything.
         * `null` means none was supplied. This is the question the whole route
         * exists for, answered without a round trip through `smtp-encode`.
         */
        submittedMatches,

        note:
          fragileCharactersIn(pass).length > 0 && !usingBase64
            ? 'Compare `length` and `fingerprint` with `npm run smtp-encode`. If they ' +
              'differ, this process is NOT holding the password you entered — set ' +
              'SMTP_PASS_B64 instead of SMTP_PASS.'
            : 'Compare `fingerprint` with `npm run smtp-encode` to confirm they match.',
      },

      auth: {
        attempted: body?.verify === true,
        accepted: authAccepted,
        error: authError,
        note:
          'null means `{"verify":true}` was not sent. A 535 means the password ' +
          'reached the server and was rejected; a timeout or ENOTFOUND means it ' +
          'never got that far and the credentials are not the problem.',
      },

      envFiles: {
        // A file cannot override a variable the panel already set — dotenv only
        // fills gaps. But a file is also where an unquoted `#` truncates, so
        // knowing one is present is directly relevant here.
        present: ENV_FILES.filter((name) => existsSync(join(process.cwd(), name))),
        note:
          'These fill in variables the panel did NOT set; they cannot override one ' +
          'it did. An unquoted "#" inside any of them truncates that value silently.',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
