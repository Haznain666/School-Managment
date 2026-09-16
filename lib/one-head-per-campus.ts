import 'server-only';

import { and, eq, isNull, ne, type SQL } from 'drizzle-orm';

import { branches, schoolUsers } from '@/db/schema';

import { db, type Database } from './drizzle';

/**
 * One Principal and one Vice Principal per campus — the sentence before the
 * `23505`. Sprint 33b.
 *
 * ── The decision ─────────────────────────────────────────────────────────
 * Decision 2, and the product owner's follow-up of 2026-09-16: **divisions
 * inside a campus are retired.** A campus has one Principal and one Vice
 * Principal, everywhere, and the heads of what used to be divisions are
 * Section Heads. Migration `0048` makes that a fact with four partial unique
 * indexes on `school_users` — **only once no school has a duplicate left**, so
 * it counts first and reports rather than failing.
 *
 * ── Why a read, when the index exists ────────────────────────────────────
 * The index is the guarantee; this is the sentence. Without it the school
 * meets a raw `23505` on whichever screen made the second head — the invite
 * form, the invitee's own accept link, the role dropdown on a profile, a
 * reactivation, or the branch form's "who heads this campus" field. So every
 * one of those asks `headConflict` first and names the person already there,
 * and catches `isOneHeadIndexConflict` after, because a check and a write are
 * two statements and a second administrator can arrive between them. The same
 * pair `emailHolderAt` / `isEmailIndexConflict` already is for addresses.
 *
 * ── Exactly the index's own rule, and no stricter ────────────────────────
 * A campus head is compared with other heads **of that campus**; a school-wide
 * head (`branch_id` null) with other school-wide heads. A school-wide Principal
 * does not block a campus Principal: that is how `0048`'s indexes are written,
 * and a read stricter than the index would refuse something the database
 * allows, on a rule nobody has decided.
 */

export const HEAD_ROLES = ['principal', 'vice_principal'] as const;
export type HeadRole = (typeof HEAD_ROLES)[number];

export function isHeadRole(role: unknown): role is HeadRole {
  return typeof role === 'string' && (HEAD_ROLES as readonly string[]).includes(role);
}

const HEAD_LABELS: Record<HeadRole, string> = {
  principal: 'a Principal',
  vice_principal: 'a Vice Principal',
};

/** The four indexes `0048` creates, named once for every reader. */
export const ONE_HEAD_INDEXES = [
  'school_users_one_principal_per_branch_idx',
  'school_users_one_principal_school_wide_idx',
  'school_users_one_vice_principal_per_branch_idx',
  'school_users_one_vice_principal_school_wide_idx',
] as const;

/**
 * The active holders of one head role at one campus — or school-wide when
 * `branchId` is null — excluding the person being edited.
 *
 * `runner` defaults to the application's connection; `createFirstSchoolAdmin`
 * passes the one it was given.
 */
export async function headsAtBranch(
  locationId: string,
  role: HeadRole,
  branchId: string | null,
  excludeUserId: string | null = null,
  runner: Database = db,
): Promise<Array<{ id: string; name: string }>> {
  const conditions: SQL[] = [
    eq(schoolUsers.locationId, locationId),
    eq(schoolUsers.role, role),
    eq(schoolUsers.isActive, true),
    branchId === null ? isNull(schoolUsers.branchId) : eq(schoolUsers.branchId, branchId),
  ];
  if (excludeUserId !== null) conditions.push(ne(schoolUsers.id, excludeUserId));

  return runner
    .select({ id: schoolUsers.id, name: schoolUsers.name })
    .from(schoolUsers)
    .where(and(...conditions))
    .orderBy(schoolUsers.name);
}

export interface HeadCandidate {
  role: string;
  branchId: string | null;
  /** A row being switched off can never be a second head. */
  isActive?: boolean;
  /** The row being edited, so it does not collide with itself. */
  excludeUserId?: string | null;
}

/**
 * Why this person cannot be a head here — naming whoever already is — or null.
 *
 * *"Askari Main Campus already has a Principal, Imran Qureshi."* followed by
 * the two things somebody can actually do about it.
 */
export async function headConflict(
  locationId: string,
  candidate: HeadCandidate,
  runner: Database = db,
): Promise<string | null> {
  if (!isHeadRole(candidate.role)) return null;
  if (candidate.isActive === false) return null;

  const holders = await headsAtBranch(
    locationId,
    candidate.role,
    candidate.branchId,
    candidate.excludeUserId ?? null,
    runner,
  );
  const holder = holders[0];
  if (holder === undefined) return null;

  const where =
    candidate.branchId === null
      ? `Your school already has a school-wide ${HEAD_LABELS[candidate.role].replace(/^an? /, '')}`
      : `${await campusName(locationId, candidate.branchId, runner)} already has ${HEAD_LABELS[candidate.role]}`;

  return (
    `${where}, ${holder.name}. ` +
    'A campus has one Principal and one Vice Principal — change their role first, ' +
    'or make this person a Section Head.'
  );
}

async function campusName(
  locationId: string,
  branchId: string,
  runner: Database,
): Promise<string> {
  const rows = await runner
    .select({ name: branches.name })
    .from(branches)
    .where(and(eq(branches.locationId, locationId), eq(branches.id, branchId)))
    .limit(1);

  return rows[0]?.name ?? 'That campus';
}

/**
 * Whether a write failed on one of `0048`'s indexes.
 *
 * The SQLSTATE is on the error's `cause` chain, not on the error — postgres-js
 * raises it and Drizzle wraps it — so the chain is walked, exactly as
 * `isEmailIndexConflict` does.
 */
export function isOneHeadIndexConflict(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; message?: unknown };
    if (candidate.code === '23505') {
      const named = `${String(candidate.constraint_name ?? '')} ${String(candidate.message ?? '')}`;
      return ONE_HEAD_INDEXES.some((index) => named.includes(index));
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/** The sentence for the race, when the pre-check passed and the index did not. */
export const HEAD_RACE_MESSAGE =
  'Somebody else was made head of that campus a moment ago. A campus has one ' +
  'Principal and one Vice Principal — reload to see who.';
