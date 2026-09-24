import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { createClient, type User } from '@supabase/supabase-js';
import { and, asc, eq, gt, isNull, like } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';

import { LOGIN_HANDOFF_TTL_SECONDS, loginHandoffTokens, schoolUsers, schools } from '@/db/schema';
import { ROLE_LABELS, isUserRole, type UserRole } from '@/types/school-auth';

import { db } from './drizzle';
import { requireServerEnv } from './env';

/**
 * The apex sign-in — Sprint 35, §7.
 *
 * One form on `schoolhub.<apex>` for everybody: a super admin, and every school
 * user — staff, parents, students. The school-subdomain sign-in pages keep
 * working exactly as they did; this is a second door, not a replacement.
 *
 * ── Why the password is checked without a cookie ─────────────────────────
 * The apex and a school are different hosts, and a cookie the apex writes is
 * never sent to `<slug>.<apex>`. So signing in here with the cookie-bound
 * client would leave a Supabase session on a host nobody uses and nothing on
 * the one they are going to. The password is checked with a throwaway client
 * that persists nothing; the session is then minted **on the school's own
 * host**, by the single-use hand-off below, which is the same shape the Super
 * Admin's "Login as Admin" has used since Stage 4.
 *
 * ── Why the hand-off is a row and not a signed token ─────────────────────
 * See `db/schema/login-handoff-tokens.ts`: this one signs in as a real person,
 * so it is single-use (claimed, not checked) and sixty seconds long, and only
 * its hash is stored.
 *
 * ── One message for every failure ────────────────────────────────────────
 * A wrong password, an unknown address, an address with no school, and an
 * address that belongs to a super admin with the wrong password all answer the
 * same sentence (§7.5). Anything else is an enumeration oracle.
 */

const ISSUER = 'sms-platform';
const CHOOSER_AUDIENCE = 'central-chooser';

/** Five minutes to pick a school from the list. Then sign in again. */
const CHOOSER_SECONDS = 5 * 60;

/** How many student-credential addresses a bare ID may match. */
const MAX_STUDENT_MATCHES = 3;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(requireServerEnv('SUPER_ADMIN_JWT_SECRET'));
}

/* ═══════════════════════════════════════════════════════════ identity */

/**
 * The addresses a Login ID could mean.
 *
 * An address is itself. Anything without an `@` is a student's ID: pupils sign
 * in on a reserved `.invalid` address minted from their admission number
 * (`lib/student-credentials.ts`), which nobody could be expected to type. So
 * the ID is matched against the local part of those addresses — across schools,
 * because the apex does not know which school the pupil is at — and each match
 * is tried in turn. The pattern is built from a sanitised local part (the same
 * rule that minted the address), so a `%` typed into the form matches nothing.
 */
export async function candidateEmailsFor(loginId: string): Promise<string[]> {
  const trimmed = loginId.trim().toLowerCase();
  if (trimmed === '') return [];
  if (trimmed.includes('@')) return [trimmed];

  const local = trimmed.replace(/[^a-z0-9._-]/g, '-');
  if (local.replace(/-/g, '') === '') return [];

  const rows = await db
    .select({ email: schoolUsers.email })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.role, 'student'),
        eq(schoolUsers.isActive, true),
        like(schoolUsers.email, `${local}@students.%.invalid`),
      ),
    )
    .limit(MAX_STUDENT_MATCHES);

  return [...new Set(rows.map((row) => row.email).filter((email): email is string => email !== null))];
}

/**
 * Checks a password against Supabase without writing a session anywhere.
 *
 * `persistSession: false` and no cookie adapter: the session GoTrue returns is
 * held in memory for the length of this call and then signed out locally, so
 * the refresh token it minted is revoked rather than left live with nobody
 * holding it.
 */
export async function verifySchoolPassword(email: string, password: string): Promise<User | null> {
  const client = createClient(
    requireServerEnv('SUPABASE_URL').trim().replace(/\/+$/, ''),
    requireServerEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error !== null || data.user === null) return null;

  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // The refresh token simply expires on its own; nothing depends on this.
  }

  return data.user;
}

/* ═══════════════════════════════════════════════════════════ memberships */

export interface CentralMembership {
  schoolId: string;
  locationId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  role: UserRole;
  roleLabel: string;
}

/**
 * Where this account may go: active memberships at active schools.
 *
 * A deactivated membership or a closed school does not appear (§7.2). A
 * **blocked** school does: its administrator must still be able to reach the
 * page that says what is owed, and everybody else lands on the notice that
 * tells them why the portal is closed — which is better than being told their
 * password is wrong.
 */
export async function membershipsFor(authUserId: string): Promise<CentralMembership[]> {
  const rows = await db
    .select({
      schoolId: schools.id,
      locationId: schools.locationId,
      slug: schools.slug,
      name: schools.name,
      logoUrl: schools.logoUrl,
      role: schoolUsers.role,
    })
    .from(schoolUsers)
    .innerJoin(schools, eq(schools.locationId, schoolUsers.locationId))
    .where(
      and(
        eq(schoolUsers.authUserId, authUserId),
        eq(schoolUsers.isActive, true),
        eq(schools.isActive, true),
      ),
    )
    .orderBy(asc(schools.name));

  const memberships: CentralMembership[] = [];
  for (const row of rows) {
    if (!isUserRole(row.role)) continue;
    memberships.push({ ...row, role: row.role, roleLabel: ROLE_LABELS[row.role] });
  }
  return memberships;
}

/* ═══════════════════════════════════════════════════════════ the chooser */

/**
 * A signed note that this account proved its password a moment ago, so
 * picking a school from the list does not ask for it again. Five minutes,
 * bound to the account, and useless on its own: redeeming it only mints a
 * hand-off for a school the account is still a member of *at that moment*.
 */
export async function signChooserToken(user: { id: string; email: string }): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ uid: user.id, email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(CHOOSER_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + CHOOSER_SECONDS)
    .sign(secretKey());
}

export async function verifyChooserToken(
  token: string,
): Promise<{ id: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: CHOOSER_AUDIENCE,
      algorithms: ['HS256'],
    });
    const id = payload['uid'];
    const email = payload['email'];
    if (typeof id !== 'string' || id === '' || typeof email !== 'string' || email === '') return null;
    return { id, email };
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════ the hand-off */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Mints a sixty-second, single-use hand-off into one school. */
export async function createLoginHandoff(input: {
  locationId: string;
  authUserId: string;
  email: string;
}): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(loginHandoffTokens).values({
    locationId: input.locationId,
    authUserId: input.authUserId,
    email: input.email,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + LOGIN_HANDOFF_TTL_SECONDS * 1000),
  });
  return token;
}

/**
 * Redeems a hand-off at the school it names — claimed, not checked.
 *
 * One conditional `UPDATE … WHERE used_at IS NULL AND expires_at > now()
 * AND location_id = <this school> RETURNING`: Postgres decides on one row that
 * exactly one request gets it. A token for another school, an expired one, a
 * spent one and an invented one all return null — indistinguishably.
 */
export async function redeemLoginHandoff(
  token: string,
  locationId: string,
): Promise<{ authUserId: string; email: string } | null> {
  if (token === '' || token.length > 200) return null;

  const claimed = await db
    .update(loginHandoffTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(loginHandoffTokens.tokenHash, hashToken(token)),
        eq(loginHandoffTokens.locationId, locationId),
        isNull(loginHandoffTokens.usedAt),
        gt(loginHandoffTokens.expiresAt, new Date()),
      ),
    )
    .returning({ authUserId: loginHandoffTokens.authUserId, email: loginHandoffTokens.email });

  return claimed[0] ?? null;
}

/** The membership a redeemed hand-off opens, re-checked at redemption. */
export async function activeMembershipAt(
  locationId: string,
  authUserId: string,
): Promise<{ role: UserRole } | null> {
  const rows = await db
    .select({ role: schoolUsers.role })
    .from(schoolUsers)
    .innerJoin(schools, eq(schools.locationId, schoolUsers.locationId))
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.authUserId, authUserId),
        eq(schoolUsers.isActive, true),
        eq(schools.isActive, true),
      ),
    )
    .limit(1);

  const role = rows[0]?.role;
  return role !== undefined && isUserRole(role) ? { role } : null;
}
