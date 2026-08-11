import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { compare } from 'bcryptjs';
import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { safeEqual } from '@/lib/crypto';
import { serverEnv } from '@/lib/env';
import { describeHashShape, normalizeBcryptHash } from '@/lib/super-admin-hash-shape';

/**
 * POST /api/internal/super-admin-check — what does the *deployed* process hold?
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * A Super Admin sign-in was failing on Hostinger with credentials that were
 * correct everywhere they could be inspected. Every tool for diagnosing it ran
 * somewhere other than the process serving the request: a local dev server, an
 * SSH session with its own environment, a script reading its own `process.env`.
 * None of them can prove anything about production, and treating them as if
 * they could is what kept the fault alive across three sessions.
 *
 * This runs *inside the deployed process*. It reports what that process holds,
 * which host is serving it, and — given a candidate password — whether bcrypt
 * accepts it there. It is the only honest answer to "is production configured
 * the way I think it is".
 *
 * ── Why it is safe to expose these particular facts ──────────────────────
 * Nothing here can reconstruct a credential:
 *
 *   - The hash is described, never returned: its length, its `$2b$12$` prefix
 *     (universal to bcrypt), and a **fingerprint** — the first 12 hex of
 *     SHA-256 over the value. A fingerprint proves two values are the same
 *     without revealing either, which is exactly the question being asked:
 *     "is the panel's value the one the process has?" Compute the same
 *     fingerprint locally with `npm run fingerprint` and compare.
 *   - `SUPER_ADMIN_EMAIL` is returned in full. It is an operator's address, not
 *     a secret, and the whole point is to compare it with what is being typed.
 *   - The password, if supplied, is compared and discarded. Only a boolean
 *     leaves this route, and it is never logged.
 *
 * ── Why it is guarded the way it is ──────────────────────────────────────
 * A route that answers "is this password right" is a login oracle, and unlike
 * `/api/super-admin/auth/login` it is not behind the attempt throttle. So it
 * requires `SUPER_ADMIN_DIAGNOSTICS_SECRET`, compared in constant time, and
 * refuses everything when that variable is unset — which is its state on any
 * deployment that has not deliberately switched it on. The secret travels in a
 * header, never a query string, so it stays out of access logs and referrers.
 *
 * **Unset the variable once the deployment is healthy.** This is a debugging
 * instrument, not a feature, and it should be dark in normal operation.
 */

// bcrypt, `fs` and `process` all need Node. Never prerender: the entire value
// of this route is that it reads the live process at request time.
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
  password?: unknown;
  email?: unknown;
}

/**
 * A stable handle for a value, revealing nothing about it.
 *
 * Twelve hex characters is 48 bits: ample to confirm two values match, far too
 * little to attack a bcrypt hash with, and short enough to compare by eye
 * across a terminal and a browser.
 */
function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

export async function POST(request: NextRequest) {
  try {
    // Trimmed, because HTTP strips leading and trailing whitespace from header
    // values in transit. A panel entry with a stray space or newline could
    // therefore never be matched by any client, and the endpoint would be
    // permanently locked out while still answering 401 — indistinguishable
    // from a wrong secret, and undiagnosable from outside. Whitespace at the
    // ends of a secret carries no entropy anyone relies on; being reachable
    // does.
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
    const rawEmail = process.env.SUPER_ADMIN_EMAIL;
    const rawHash = process.env.SUPER_ADMIN_PASSWORD_HASH;
    const rawSecret = process.env.SUPER_ADMIN_JWT_SECRET;

    const shape = describeHashShape(rawHash);
    const normalizedHash = normalizeBcryptHash(rawHash);
    const wasRepaired = rawHash !== undefined && normalizedHash !== rawHash;

    // -- Which process is answering ----------------------------------------
    // The double-start seen in the Hostinger log means "which instance served
    // this" is a real question. Call twice: a differing pid proves more than
    // one process is behind the proxy, and they may not hold the same env.
    const process_ = {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      platform: `${process.platform}/${process.arch}`,
      cwd: process.cwd(),
      nodeEnv: process.env.NODE_ENV ?? '(unset)',
      hostname: request.headers.get('host') ?? '(none)',
    };

    // -- Anything that could be filling gaps the panel left ------------------
    const envFilesPresent = ENV_FILES.filter((name) =>
      existsSync(join(process.cwd(), name)),
    );

    // -- The comparison, in this process ------------------------------------
    let emailMatches: boolean | null = null;
    let passwordMatches: boolean | null = null;
    let comparisonError: string | null = null;

    const submittedEmail = typeof body?.email === 'string' ? body.email : null;
    const submittedPassword = typeof body?.password === 'string' ? body.password : null;

    if (submittedEmail !== null && rawEmail !== undefined) {
      emailMatches =
        submittedEmail.trim().toLowerCase() === rawEmail.trim().toLowerCase();
    }

    if (submittedPassword !== null && rawHash !== undefined) {
      try {
        // Against the NORMALISED hash, because that is what the login route
        // compares against. A diagnostic that disagrees with production is
        // worse than no diagnostic.
        passwordMatches = await compare(submittedPassword, normalizedHash ?? '');
      } catch (error) {
        // bcryptjs only throws on non-string input; a malformed hash returns
        // false. Surfaced anyway so the answer is never silently "no".
        comparisonError = error instanceof Error ? error.message : String(error);
      }
    }

    return apiSuccess({
      process: process_,

      superAdminEmail: {
        // Not a secret; comparing it against what is typed is the point.
        value: rawEmail ?? null,
        length: rawEmail?.length ?? 0,
        hasSurroundingWhitespace: rawEmail !== undefined && rawEmail !== rawEmail.trim(),
      },

      passwordHash: {
        present: rawHash !== undefined && rawHash !== '',
        length: rawHash?.length ?? 0,
        prefix: rawHash?.slice(0, 7) ?? null,
        containsBackslash: rawHash?.includes('\\') ?? false,
        hasSurroundingWhitespace: rawHash !== undefined && rawHash !== rawHash.trim(),
        // Compare with `npm run fingerprint` over the panel's value.
        fingerprint: rawHash === undefined ? null : fingerprint(rawHash),
        wellFormed: shape.ok,
        verdict: shape.message,

        // What the login route actually compares against. When these differ
        // from the raw values above, the stored value was damaged in transit
        // and repaired on read — which says the panel still needs correcting
        // even though sign-in now works.
        repairedOnRead: wasRepaired,
        effectiveLength: normalizedHash?.length ?? 0,
        effectivePrefix: normalizedHash?.slice(0, 7) ?? null,
        effectiveFingerprint:
          normalizedHash === undefined ? null : fingerprint(normalizedHash),
      },

      jwtSecret: {
        present: rawSecret !== undefined && rawSecret !== '',
        length: rawSecret?.length ?? 0,
        fingerprint: rawSecret === undefined ? null : fingerprint(rawSecret),
      },

      envFiles: {
        // A file cannot override a variable the panel already set — dotenv does
        // not replace what the environment holds. It only fills gaps, which is
        // still worth knowing about.
        present: envFilesPresent,
        note:
          envFilesPresent.length === 0
            ? 'None. Every variable came from the host environment.'
            : 'These fill in variables the panel did NOT set. They cannot override one it did.',
      },

      comparison: {
        emailMatches,
        passwordMatches,
        comparisonError,
        note: 'null means the field was not supplied in the request body.',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
