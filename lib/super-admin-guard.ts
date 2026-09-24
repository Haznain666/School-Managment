import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import {
  actorFromRow,
  environmentOwnerActor,
  environmentOwnerEmail,
  findSuperAdminByEmail,
  findSuperAdminById,
  superAdminTableState,
  type SuperAdminActor,
} from './super-admin-accounts';
import {
  SUPER_ADMIN_COOKIE,
  verifySuperAdminJWT,
  type SuperAdminSession,
} from './super-admin-auth';
import {
  superAdminCan,
  type SuperAdminAction,
  type SuperAdminArea,
} from './super-admin-permissions';

/**
 * Server-side Super Admin session helpers.
 *
 * `middleware.ts` already redirects unauthenticated traffic away from
 * `/super-admin/*`, so these are the second line: they make the session
 * available to server components and make API routes fail closed even if the
 * matcher is ever changed.
 *
 * ── Sprint 35: the token says who, the row says whether ──────────────────
 * With one operator in an env var, a valid signature was the whole answer.
 * With several, a signature proves only that we issued the token — not that
 * its holder is still active, nor what they may do. So the row is re-read on
 * every request (memoised per request, one indexed lookup), and deactivating an
 * admin takes effect on their next click, not when their eight hours run out.
 * The same arrangement `membershipFor()` gives the school portals.
 */

export class SuperAdminAuthError extends Error {
  readonly status = 401;

  constructor(message = 'Super Admin session required.') {
    super(message);
    this.name = 'SuperAdminAuthError';
  }
}

/** Signed in and active, but this area is not theirs. */
export class SuperAdminForbiddenError extends Error {
  readonly status = 403;

  constructor(message = 'Your super admin account does not have access to this.') {
    super(message);
    this.name = 'SuperAdminForbiddenError';
  }
}

/** Reads the signed session from the request cookies. Null when not signed in. */
export async function readSuperAdminSession(): Promise<SuperAdminSession | null> {
  const store = await cookies();
  const token = store.get(SUPER_ADMIN_COOKIE)?.value;
  if (token === undefined || token === '') return null;
  return verifySuperAdminJWT(token);
}

/**
 * The session, resolved against `super_admin_users`. Null when there is no
 * session, or the row behind it is gone or inactive.
 *
 * ── The fallback, and exactly when it applies ────────────────────────────
 * A token with no `adminId` came from the environment-credential sign-in (or
 * predates this sprint). It resolves to the owner **only** while the table is
 * unreachable or empty — the two states in which that sign-in is allowed at
 * all. Once the table holds people, such a token is looked up by address like
 * any other, and refused if nobody there has it. A token that *does* carry an
 * id and meets an unreachable table is refused: failing open is for the owner
 * the environment names, not for whoever happens to be holding a cookie.
 */
export const readSuperAdminActor = cache(async (): Promise<SuperAdminActor | null> => {
  const session = await readSuperAdminSession();
  if (session === null) return null;

  const ownerEmail = environmentOwnerEmail();
  const isEnvironmentOwner = ownerEmail !== null && session.email.toLowerCase() === ownerEmail;

  try {
    const row =
      session.adminId !== null
        ? await findSuperAdminById(session.adminId)
        : await findSuperAdminByEmail(session.email);

    if (row !== null) {
      return row.isActive ? actorFromRow(row, session.issuedAt) : null;
    }
  } catch (error) {
    console.error('[super-admin] could not re-read the operator; fallback considered:', error);
    return session.adminId === null && isEnvironmentOwner
      ? environmentOwnerActor(session.email, session.issuedAt)
      : null;
  }

  if (session.adminId === null && isEnvironmentOwner) {
    const state = await superAdminTableState();
    if (state !== 'rows') return environmentOwnerActor(session.email, session.issuedAt);
  }

  return null;
});

/**
 * The form every `/api/super-admin/*` route uses, so that a missing session can
 * never be mistaken for an empty result.
 *
 * With an area and an action, it also refuses (403) an admin who lacks them.
 * Without, any active admin passes — for the handful of routes every operator
 * needs (their own notifications, the diagnostics) whatever else they hold.
 */
export async function requireSuperAdmin(
  area?: SuperAdminArea,
  action: SuperAdminAction = 'r',
): Promise<SuperAdminActor> {
  const actor = await readSuperAdminActor();
  if (actor === null) throw new SuperAdminAuthError();

  if (area !== undefined && !superAdminCan(actor, area, action)) {
    throw new SuperAdminForbiddenError();
  }

  return actor;
}

/** Only the owner. The permission grid, and nothing else, uses this. */
export async function requireSuperAdminOwner(): Promise<SuperAdminActor> {
  const actor = await requireSuperAdmin();
  if (!actor.isOwner) {
    throw new SuperAdminForbiddenError('Only the platform owner can do this.');
  }
  return actor;
}

/**
 * The page-shaped guard. Redirects rather than throwing: to sign-in (through
 * the logout route, which clears a cookie that has stopped meaning anything)
 * when the session is not a live admin, and to the dashboard when it is one
 * who lacks this area — a stale bookmark should land somewhere useful.
 */
export async function requireSuperAdminPage(
  area?: SuperAdminArea,
  action: SuperAdminAction = 'r',
): Promise<SuperAdminActor> {
  const actor = await readSuperAdminActor();
  if (actor === null) redirect('/api/super-admin/auth/logout');

  if (area !== undefined && !superAdminCan(actor, area, action)) {
    redirect('/super-admin?denied=1');
  }

  return actor;
}
