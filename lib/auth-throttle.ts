import 'server-only';

import { createHash } from 'node:crypto';

import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { authAttempts, type AuthAttemptScope } from '@/db/schema';

import { apiFailure } from './api-response';
import { db } from './drizzle';
import { serverEnv } from './env';

/**
 * Rate limiting and account lockout for the unauthenticated surface.
 *
 * ── Why Postgres and not Upstash ─────────────────────────────────────────
 * The document this sprint derives from assumed `@upstash/ratelimit`. That is
 * the right answer on a platform with many short-lived serverless instances and
 * no shared memory. This runs as one persistent Node process on Hostinger
 * against a Postgres it already holds a pool to, so an in-process counter would
 * be lost on every restart and a Redis would be a new vendor, a new secret and
 * a new thing to be down. The table is also the audit trail Sprint 23's
 * security review will ask for, which no counter is.
 *
 * The cost is one indexed SELECT per auth request. Against the ~103-second
 * email this sprint also removes, it does not register.
 *
 * ── Two axes, because either one alone is wrong ──────────────────────────
 * **Per email, strict.** Five failures in fifteen minutes and that address is
 * refused for fifteen minutes. This is what stops someone grinding one
 * account's password.
 *
 * **Per IP, loose.** Schools in this market sit behind shared NAT — an entire
 * staff room, sometimes an entire town's cable segment, arrives from one
 * address. An IP-only limit therefore punishes the customer, so this axis is
 * set high enough that normal simultaneous use never reaches it and only a
 * script does. It exists to stop the other attack: one origin spraying one
 * common password across a thousand different addresses, where no single email
 * counter ever reaches five.
 *
 * Neither limit alone covers both attacks. That is why there are two.
 *
 * ── Non-enumeration is the easiest thing here to get wrong ───────────────
 * Everything this module counts is *attempt rows*, which exist whether or not
 * the address belongs to an account. It never reads `school_users`, and no
 * caller may consult it before calling `checkThrottle` — otherwise an unknown
 * address would answer faster, or differently, and the login page becomes a
 * directory of the school's staff. `throttledResponse()` exists so every route
 * emits the same bytes for the same reason.
 */

/** The window every limit is measured over. */
const WINDOW_MINUTES = 15;
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;

/** Rows older than this are swept opportunistically. */
const RETENTION_HOURS = 24;

/** Roughly one write in this many also sweeps. */
const CLEANUP_ODDS = 50;

interface ScopePolicy {
  /** Failures against one identifier before it is refused. */
  identifierLimit: number;
  /** Failures from one IP before it is refused. */
  ipLimit: number;
  /**
   * Whether a *successful* attempt counts toward the limits.
   *
   * False for the credential endpoints, where success is the thing being
   * protected and a success is what clears the streak.
   *
   * True for the two endpoints that send mail, where success is unconditional
   * by design — `/auth/otp/request` answers identically for an address it has
   * never seen, precisely so it cannot be enumerated — so counting only
   * failures would leave them with no limit at all. There the volume *is* the
   * harm: every call costs an SMTP send and lands in somebody's inbox.
   */
  countSuccesses: boolean;
}

const POLICY: Record<AuthAttemptScope, ScopePolicy> = {
  login: { identifierLimit: 5, ipLimit: 30, countSuccesses: false },
  // Fewer, because there is exactly one super-admin account on a deployment
  // and nobody legitimate is coming from thirty different sessions.
  super_admin_login: { identifierLimit: 5, ipLimit: 20, countSuccesses: false },
  otp_request: { identifierLimit: 5, ipLimit: 30, countSuccesses: true },
  password_reset: { identifierLimit: 5, ipLimit: 30, countSuccesses: false },
  setup: { identifierLimit: 5, ipLimit: 30, countSuccesses: false },
};

export type ThrottleReason = 'ok' | 'identifier_locked' | 'ip_throttled';

export interface ThrottleDecision {
  allowed: boolean;
  /** Seconds until the caller may try again. Zero when allowed. */
  retryAfterSeconds: number;
  reason: ThrottleReason;
}

const ALLOWED: ThrottleDecision = {
  allowed: true,
  retryAfterSeconds: 0,
  reason: 'ok',
};

/** Lowercased and trimmed, so `A@b.com ` and `a@b.com` share one counter. */
export function throttleIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * A stable, non-reversible handle for the client's origin.
 *
 * ── Why hashed ───────────────────────────────────────────────────────────
 * The limiter only ever asks "is this the same origin as last time", which a
 * digest answers exactly. Keeping the address itself would put a map of where
 * every member of every school signs in from into a table nobody guards, for no
 * gain.
 *
 * ── Why salted ───────────────────────────────────────────────────────────
 * IPv4 is thirty-two bits; an unsalted digest of one is reversible by brute
 * force in seconds, which would make "hashed" decorative. `ENCRYPTION_KEY` is
 * reused as the salt rather than adding a secret nobody would remember to set —
 * it is already required in every environment that matters. If it is absent
 * the digest is still stable and the limiter still works; only the
 * irreversibility is lost, and that is the correct order of failure.
 */
export function clientIpHash(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const first = forwarded.split(',')[0]?.trim() ?? '';
  const ip = first !== '' ? first : (request.headers.get('x-real-ip') ?? '').trim();

  // An origin we cannot identify is bucketed together under one handle rather
  // than exempted. Sharing a bucket is a worse experience than having one; not
  // having one at all is a hole.
  const subject = ip === '' ? 'unknown' : ip;

  return createHash('sha256')
    .update(`${serverEnv('ENCRYPTION_KEY', 'sms-platform')}:${subject}`)
    .digest('hex');
}

/**
 * Records what happened. Call once per attempt, on both outcomes, and only for
 * attempts that were actually made — a request refused by `checkThrottle` must
 * not be recorded, or a locked-out account would extend its own lock forever
 * by retrying.
 *
 * Never throws: a limiter that can fail a login because its bookkeeping failed
 * is worse than one that occasionally misses a row.
 */
export async function recordAttempt(
  scope: AuthAttemptScope,
  identifier: string,
  ipHash: string,
  succeeded: boolean,
): Promise<void> {
  try {
    await db.insert(authAttempts).values({
      scope,
      identifier: throttleIdentifier(identifier),
      ipHash,
      succeeded,
    });

    await maybeSweep();
  } catch (error) {
    console.warn('[auth-throttle] could not record attempt:', error);
  }
}

/**
 * May this attempt proceed?
 *
 * Fails **open**: if the database cannot be reached, sign-in still works. A
 * limiter that takes the whole product down when it is unavailable trades a
 * rare attack for a certain outage.
 */
export async function checkThrottle(
  scope: AuthAttemptScope,
  identifier: string,
  ipHash: string,
): Promise<ThrottleDecision> {
  const policy = POLICY[scope];
  const since = new Date(Date.now() - WINDOW_MS);

  try {
    const [byIdentifier, byIp] = await Promise.all([
      db
        .select({ succeeded: authAttempts.succeeded, createdAt: authAttempts.createdAt })
        .from(authAttempts)
        .where(
          and(
            eq(authAttempts.scope, scope),
            eq(authAttempts.identifier, throttleIdentifier(identifier)),
            gte(authAttempts.createdAt, since),
          ),
        )
        .orderBy(desc(authAttempts.createdAt))
        .limit(policy.identifierLimit + 1),
      db
        .select({ succeeded: authAttempts.succeeded, createdAt: authAttempts.createdAt })
        .from(authAttempts)
        .where(
          and(
            eq(authAttempts.scope, scope),
            eq(authAttempts.ipHash, ipHash),
            gte(authAttempts.createdAt, since),
          ),
        )
        .orderBy(desc(authAttempts.createdAt))
        .limit(policy.ipLimit + 1),
    ]);

    // The identifier axis is checked first so a legitimate person locked out on
    // a busy shared connection is told about the lock, which is the one of the
    // two they can act on.
    const locked = verdict(byIdentifier, policy, 'identifier_locked');
    if (!locked.allowed) return locked;

    return verdict(byIp, policy, 'ip_throttled');
  } catch (error) {
    console.warn('[auth-throttle] check failed, allowing the attempt:', error);
    return ALLOWED;
  }
}

interface AttemptRow {
  succeeded: boolean;
  createdAt: Date;
}

/**
 * Counts backwards from the newest attempt and decides.
 *
 * ── Why only the identifier axis stops at a success ──────────────────────
 * Signing in correctly clears *that address's* streak. Without it, someone who
 * mistyped four times, got in, then locked their screen and came back would be
 * one typo from a fifteen-minute lockout for the rest of the window — and the
 * failures that preceded a success are, by definition, no longer evidence of
 * anything about that account.
 *
 * The IP axis must not work that way. It is counting a spray across many
 * addresses, and an attacker who also holds one valid account could otherwise
 * reset the whole origin's counter at will by signing into it. There a success
 * is merely not counted; it clears nothing.
 *
 * ── Where the retry time comes from ──────────────────────────────────────
 * The lock lifts when the *oldest* of the counted failures leaves the fifteen
 * minute window, so it expires on its own and needs no `locked_until` column.
 * Attempts made while locked are never recorded, so retrying does not extend
 * it — that asymmetry is deliberate and is what stops a lockout becoming
 * permanent for a client that keeps polling.
 */
function verdict(
  rows: readonly AttemptRow[],
  policy: ScopePolicy,
  reason: Exclude<ThrottleReason, 'ok'>,
): ThrottleDecision {
  const isIdentifier = reason === 'identifier_locked';
  const limit = isIdentifier ? policy.identifierLimit : policy.ipLimit;
  const counted: Date[] = [];

  for (const row of rows) {
    if (row.succeeded && !policy.countSuccesses) {
      // Identifier: the streak is over. IP: this one simply does not count.
      if (isIdentifier) break;
      continue;
    }
    counted.push(row.createdAt);
  }

  if (counted.length < limit) return ALLOWED;

  const oldest = counted[limit - 1];
  if (oldest === undefined) return ALLOWED;

  const freeAt = oldest.getTime() + WINDOW_MS;
  const seconds = Math.ceil((freeAt - Date.now()) / 1000);

  if (seconds <= 0) return ALLOWED;

  return { allowed: false, retryAfterSeconds: seconds, reason };
}

/**
 * The one response every throttled endpoint returns.
 *
 * ── Why it lives here ────────────────────────────────────────────────────
 * A refusal must be byte-identical for an address that exists and one that does
 * not, and the surest way to guarantee that is for there to be one function
 * that writes it. Nothing in it is derived from an account: the reason
 * distinguishes "this identity is locked" from "this origin is going too fast",
 * both of which are true of a made-up address exactly as often as a real one,
 * and the retry time comes from attempt rows the caller created itself.
 *
 * 429 with `Retry-After`, so a well-behaved client backs off instead of
 * hammering — and so the browser console says what happened.
 */
export function throttledResponse(decision: ThrottleDecision): NextResponse {
  const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));

  const message =
    decision.reason === 'identifier_locked'
      ? `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
      : `Too many attempts from this network. Try again in ${minutes} minute${
          minutes === 1 ? '' : 's'
        }.`;

  const response = apiFailure('too_many_attempts', message, 429);
  response.headers.set('Retry-After', String(decision.retryAfterSeconds));
  return response;
}

/**
 * Deletes rows past their usefulness, roughly one write in fifty.
 *
 * Hostinger provides no platform cron and this application has no scheduler, so
 * a sweep either rides on traffic or does not happen. The odds are what keep it
 * off the hot path: at fifty-to-one a busy deployment still sweeps several
 * times an hour, and a quiet one has nothing worth sweeping.
 */
async function maybeSweep(): Promise<void> {
  if (Math.floor(Math.random() * CLEANUP_ODDS) !== 0) return;

  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);

  try {
    await db.delete(authAttempts).where(lt(authAttempts.createdAt, cutoff));
  } catch (error) {
    console.warn('[auth-throttle] sweep failed:', error);
  }
}
