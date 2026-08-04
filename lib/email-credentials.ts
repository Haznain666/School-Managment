import 'server-only';

import { and, eq } from 'drizzle-orm';

import { userPasswords, type UserPassword } from '@/db/schema';

import { db } from './drizzle';

/**
 * Reads and writes of the password table.
 *
 * Kept apart from the routes so that "which row is this credential" is decided
 * in exactly one place. Every lookup here is scoped by `locationId` wherever
 * one is known, because the same address may hold two unrelated accounts at two
 * schools and matching on the email alone would let a password from one open
 * the other.
 */

/**
 * Finds the credential for an address.
 *
 * With a tenant, the answer is exact. Without one — which only happens on
 * deployments where no subdomain carries the school, since middleware resolves
 * it everywhere else — the address must identify exactly one account across
 * the platform. Two matches is treated as no match rather than as a guess:
 * signing someone into the wrong school is worse than asking them to arrive on
 * their school's own address.
 */
export async function findPasswordRecord(
  email: string,
  locationId: string | null,
): Promise<UserPassword | null> {
  if (locationId !== null) {
    const rows = await db
      .select()
      .from(userPasswords)
      .where(
        and(eq(userPasswords.locationId, locationId), eq(userPasswords.email, email)),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  const rows = await db
    .select()
    .from(userPasswords)
    .where(eq(userPasswords.email, email))
    .limit(2);

  return rows.length === 1 ? (rows[0] ?? null) : null;
}

export interface UpsertPasswordParams {
  locationId: string;
  email: string;
  firebaseUid: string;
  passwordHash: string;
  mustChangePassword?: boolean;
}

/**
 * Writes a credential, replacing whatever was there.
 *
 * Both paths that call this — accepting an invitation and completing a reset —
 * mean "this is the password now", so a conflict on either unique key is an
 * update rather than an error.
 */
export async function upsertPassword(params: UpsertPasswordParams): Promise<void> {
  const now = new Date();

  await db
    .insert(userPasswords)
    .values({
      locationId: params.locationId,
      email: params.email,
      firebaseUid: params.firebaseUid,
      passwordHash: params.passwordHash,
      mustChangePassword: params.mustChangePassword ?? false,
      lastPasswordChange: now,
    })
    .onConflictDoUpdate({
      target: [userPasswords.locationId, userPasswords.email],
      set: {
        firebaseUid: params.firebaseUid,
        passwordHash: params.passwordHash,
        mustChangePassword: params.mustChangePassword ?? false,
        lastPasswordChange: now,
        updatedAt: now,
      },
    });
}
