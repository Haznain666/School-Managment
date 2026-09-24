import 'server-only';

import { asc, count, eq } from 'drizzle-orm';
import { hash } from 'bcryptjs';

import { superAdminUsers, type SuperAdminUser } from '@/db/schema';

import { db } from './drizzle';
import { serverEnv } from './env';
import {
  fullSuperAdminPermissions,
  normaliseSuperAdminPermissions,
  type SuperAdminPermissions,
} from './super-admin-permissions';

/**
 * The super admins, as rows — Sprint 35, §9.
 *
 * ── The environment credential is still the owner's way in ───────────────
 * Every read in here that the sign-in or the per-request guard depends on
 * reports *whether the table could be read at all*, not just what it held.
 * That distinction is the whole of the fallback: if `super_admin_users` is
 * missing (a deploy that landed before `0052`), unreachable, or empty (after
 * `0052`, before `apply-0052.mjs` seeded the owner), the owner signs in with
 * `SUPER_ADMIN_EMAIL` and the hash in the environment, exactly as before this
 * sprint. Fail open to the old behaviour, **for the owner only** — nobody else
 * has an environment credential to fall back to, and inventing one would be a
 * door nobody knows is there.
 */

/** bcrypt cost. The same the hash script uses for the environment credential. */
const BCRYPT_COST = 12;

/** What the rest of the application knows about the person signed in. */
export interface SuperAdminActor {
  /** Null only for the environment-credential fallback. */
  adminId: string | null;
  email: string;
  name: string;
  isOwner: boolean;
  permissions: SuperAdminPermissions;
  /** Issued-at of the session, epoch seconds. */
  issuedAt: number;
}

export type TableState = 'rows' | 'empty' | 'unreachable';

/** The owner's address as the environment knows it, for the fallback. */
export function environmentOwnerEmail(): string | null {
  const value = serverEnv('SUPER_ADMIN_EMAIL', '').trim().toLowerCase();
  return value === '' ? null : value;
}

/** Can the table be read, and does it hold anybody? */
export async function superAdminTableState(): Promise<TableState> {
  try {
    const rows = await db.select({ value: count() }).from(superAdminUsers);
    return (rows[0]?.value ?? 0) > 0 ? 'rows' : 'empty';
  } catch (error) {
    console.error('[super-admin] super_admin_users could not be read:', error);
    return 'unreachable';
  }
}

export function normaliseAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findSuperAdminByEmail(email: string): Promise<SuperAdminUser | null> {
  const rows = await db
    .select()
    .from(superAdminUsers)
    .where(eq(superAdminUsers.email, normaliseAdminEmail(email)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findSuperAdminById(id: string): Promise<SuperAdminUser | null> {
  const rows = await db.select().from(superAdminUsers).where(eq(superAdminUsers.id, id)).limit(1);
  return rows[0] ?? null;
}

export function actorFromRow(row: SuperAdminUser, issuedAt: number): SuperAdminActor {
  return {
    adminId: row.id,
    email: row.email,
    name: row.name,
    isOwner: row.isOwner,
    permissions: row.isOwner
      ? fullSuperAdminPermissions()
      : normaliseSuperAdminPermissions(row.permissions),
    issuedAt,
  };
}

/** The owner as the environment describes them, when the table cannot. */
export function environmentOwnerActor(email: string, issuedAt: number): SuperAdminActor {
  return {
    adminId: null,
    email,
    name: 'Platform owner',
    isOwner: true,
    permissions: fullSuperAdminPermissions(),
    issuedAt,
  };
}

/* ═══════════════════════════════════════════════════════════ listing */

export interface SuperAdminListRow {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
  isActive: boolean;
  permissions: SuperAdminPermissions;
  lastSignInAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

/** Every operator, owner first. The hash never leaves this function. */
export async function listSuperAdmins(): Promise<SuperAdminListRow[]> {
  const rows = await db
    .select({
      id: superAdminUsers.id,
      email: superAdminUsers.email,
      name: superAdminUsers.name,
      isOwner: superAdminUsers.isOwner,
      isActive: superAdminUsers.isActive,
      permissions: superAdminUsers.permissions,
      lastSignInAt: superAdminUsers.lastSignInAt,
      createdAt: superAdminUsers.createdAt,
      createdBy: superAdminUsers.createdBy,
    })
    .from(superAdminUsers)
    .orderBy(asc(superAdminUsers.createdAt));

  return rows
    .map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      isOwner: row.isOwner,
      isActive: row.isActive,
      permissions: row.isOwner
        ? fullSuperAdminPermissions()
        : normaliseSuperAdminPermissions(row.permissions),
      lastSignInAt: row.lastSignInAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
    }))
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
}

export async function hashSuperAdminPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_COST);
}

/**
 * A password an operator may set. Twelve characters, because this account can
 * switch a module off for every school on the platform.
 */
export function superAdminPasswordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 12) {
    return 'Use at least 12 characters.';
  }
  if (password.length > 200) return 'That password is too long.';
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return 'Use letters and at least one number.';
  }
  return null;
}

/** Stamped on sign-in. Best effort: a failed stamp never fails a sign-in. */
export async function recordSuperAdminSignIn(adminId: string): Promise<void> {
  try {
    await db
      .update(superAdminUsers)
      .set({ lastSignInAt: new Date() })
      .where(eq(superAdminUsers.id, adminId));
  } catch (error) {
    console.warn('[super-admin] could not stamp last sign-in:', error);
  }
}
