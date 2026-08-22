import 'server-only';

import { and, eq } from 'drizzle-orm';

import { DEFAULT_SUBCATEGORIES, resultSubcategories, schoolUsers } from '@/db/schema';

import { db as defaultDb, type Database, type Tx } from './drizzle';
import { InvalidPhoneError, normalizePhone } from './phone';
import { getOrCreateAuthUser } from './supabase-auth';

/**
 * First-administrator bootstrap.
 *
 * ── The problem this solves ──────────────────────────────────────────────
 * Every path that creates a `school_users` row requires an existing school
 * session: `POST /api/school/users` and `POST /api/school/invitations` are both
 * behind `withSchoolAuth`, and invite acceptance presupposes an invite that
 * only a signed-in member could have sent. A freshly provisioned school
 * therefore had no way to get its *first* member — nobody could sign in to
 * invite anybody, and nobody could be invited without someone signed in.
 *
 * This module is the escape hatch, and it is deliberately narrow: it creates
 * one `school_admin` and nothing else. Every other member still arrives through
 * the school's own invitation flow, so the platform operator does not become a
 * general-purpose user administrator for tenants they do not belong to.
 *
 * ── On the phone number ──────────────────────────────────────────────────
 * The number is normalised to E.164 here, and that is not cosmetic. Login looks
 * the member up with `eq(schoolUsers.phone, phone)` against a *normalised*
 * value (`otp/request/route.ts`), so a row stored as `0341-2401870` can never
 * be found by someone signing in — the account would exist and be permanently
 * unreachable. Storing it any other way would be worse than not storing it.
 */

export interface BootstrapAdminParams {
  /** GHL Location ID — the tenant key. */
  locationId: string;
  name: string;
  /** Any format `lib/phone.ts` accepts; normalised before it is stored. */
  phone: string;
  email?: string | null | undefined;
  /**
   * Defaults to `school_admin`, which is what this module was written for.
   *
   * `branch_admin` is the one other value used, by the branch form: an email
   * typed against a new campus can be invited as that campus's administrator.
   * Deliberately not open to every role — everyone else still arrives through
   * the school's own invitation flow, so the platform operator does not become
   * a general-purpose user administrator for tenants they do not belong to.
   */
  role?: 'school_admin' | 'branch_admin';
  /** The campus a `branch_admin` administers. Null for a school-wide admin. */
  branchId?: string | null | undefined;
}

/**
 * What became of the Supabase account for the administrator's address.
 *
 *  created   the address did not exist in Supabase and now does
 *  existing  it was already there — the same person at another school, or a
 *            re-run of this provisioning
 *  none      no address was supplied, so there was nothing to register
 *  failed    Supabase refused or was unreachable; `school_users` is still
 *            correct and the account is created on first password setup
 */
export type AuthAccountOutcome = 'created' | 'existing' | 'none' | 'failed';

export type BootstrapAdminResult =
  | {
      status: 'created';
      userId: string;
      phone: string;
      authAccount: AuthAccountOutcome;
    }
  /** Someone already holds that number at this school; nothing was changed. */
  | { status: 'exists'; userId: string; phone: string }
  /** Nothing usable was supplied. `reason` is safe to show an operator. */
  | { status: 'skipped'; reason: string };

/**
 * Registers the administrator's address with Supabase Auth.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 * Until now nothing created a Supabase account at the point an administrator
 * was provisioned. The account appeared much later, on the first password
 * setup, which meant `auth.users` for a live deployment contained nothing but
 * the synthetic `pa_…@…` accounts behind the operator hand-off — not one of the
 * real addresses the panel had been asked to invite. An operator looking at
 * Supabase to confirm where an invitation went found an address the platform
 * had invented and none that they had typed.
 *
 * Registering the address here also moves the discovery of a bad one forward:
 * a typo or a duplicate is refused while the operator is still on the form,
 * instead of surfacing when the recipient clicks their setup link days later.
 *
 * ── What is deliberately NOT done ────────────────────────────────────────
 * `school_users.auth_user_id` is left null. Throughout this codebase that
 * column means "this person has been through setup and can sign in" — it gates
 * the setup link (`app/api/school/auth/setup/route.ts`), chooses which of two
 * emails the panel sends, decides the "Invite pending" badge, and permits an
 * emergency link. Filling it in the moment an account is *registered* would
 * make all five say the person is established when they have no password and
 * have never signed in. The column is still written by the setup and OTP routes
 * at the moment it becomes true.
 *
 * ── Never throws ─────────────────────────────────────────────────────────
 * The `school_users` row is committed by the time this runs, and Supabase being
 * unreachable must not undo a school's provisioning. The setup route calls
 * `getOrCreateAuthUser` for the same address anyway, so a failure here costs
 * the early check and nothing else.
 */
async function registerAuthAccount(email: string): Promise<AuthAccountOutcome> {
  if (email === '') return 'none';

  try {
    const before = await getOrCreateAuthUser(email);
    // `created_at` within the last few seconds is the only signal the admin API
    // gives that this call made the account rather than found it. Used for
    // reporting only — nothing branches on it.
    const age = Date.now() - new Date(before.created_at).getTime();
    return age < 10_000 ? 'created' : 'existing';
  } catch (error) {
    console.warn(
      '[school-bootstrap] could not register the administrator address with ' +
        `Supabase: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    return 'failed';
  }
}

/**
 * Creates the school's first administrator, if the details allow it.
 *
 * Never throws for bad input — a school must still be provisioned when its
 * principal's number turns out to be a landline, so the caller gets a result to
 * report rather than a failed request to roll back.
 *
 * @param locationId  Always the tenant key of the school being provisioned.
 */
export async function createFirstSchoolAdmin(
  db: Database,
  params: BootstrapAdminParams,
): Promise<BootstrapAdminResult> {
  const name = params.name.trim();
  if (name === '') {
    return { status: 'skipped', reason: 'No administrator name was provided.' };
  }

  const rawPhone = params.phone.trim();
  if (rawPhone === '') {
    return { status: 'skipped', reason: 'No administrator phone number was provided.' };
  }

  let phone: string;
  try {
    phone = normalizePhone(rawPhone);
  } catch (error) {
    if (error instanceof InvalidPhoneError) {
      // Only malformed numbers land here. `lib/phone.ts` validates the shape
      // `+92` + ten digits and cannot tell a mobile from a landline — which
      // no longer matters, because nothing is sent to this number. It is a
      // contact detail on the record; the sign-in code goes to the address.
      return {
        status: 'skipped',
        reason: `"${rawPhone}" is not a valid Pakistani phone number, so no administrator account was created. Add one from the school's Users tab.`,
      };
    }
    throw error;
  }

  const email = (params.email ?? '').trim();

  const inserted = await db
    .insert(schoolUsers)
    .values({
      locationId: params.locationId,
      name,
      phone,
      email: email === '' ? null : email,
      role: params.role ?? 'school_admin',
      branchId: params.branchId ?? null,
      isActive: true,
      // `firebase_uid` stays null on purpose. The account is created lazily at
      // first sign-in by `getOrCreateSchoolFirebaseUser`, so this row is enough
      // to log in with — there is no invite to accept.
    })
    // Phone is unique per school, so a re-run cannot duplicate the member.
    .onConflictDoNothing({ target: [schoolUsers.locationId, schoolUsers.phone] })
    .returning({ id: schoolUsers.id });

  const created = inserted[0];
  if (created !== undefined) {
    return {
      status: 'created',
      userId: created.id,
      phone,
      authAccount: await registerAuthAccount(email),
    };
  }

  const existing = await db
    .select({ id: schoolUsers.id })
    .from(schoolUsers)
    .where(
      and(eq(schoolUsers.locationId, params.locationId), eq(schoolUsers.phone, phone)),
    )
    .limit(1);

  const row = existing[0];
  return row === undefined
    ? { status: 'skipped', reason: 'The administrator account could not be created.' }
    : { status: 'exists', userId: row.id, phone };
}

/**
 * Gives a new school the performance descriptors every school starts with.
 *
 * Idempotent, and called at provisioning beside `seedChartOfAccounts` for
 * exactly the same reason that one is: migration `0029` seeded every school
 * that existed when it ran, and without this a school created afterwards would
 * open the descriptor screen empty. A school that never notices is a school
 * whose primary teachers find the sub-category picker has nothing in it on the
 * morning they first need it.
 *
 * The list is `DEFAULT_SUBCATEGORIES` in `db/schema/result-subcategories.ts`,
 * which is the same list `0029` inserts — a school provisioned on either side
 * of that migration has to behave identically.
 *
 * Never fails a provisioning. An empty descriptor list is recoverable in four
 * clicks from the settings screen, and a school row that exists and is useful
 * must not be rolled back over it.
 */
export async function seedResultSubcategories(
  locationId: string,
  runner: Database | Tx = defaultDb,
): Promise<{ created: number }> {
  const created = await runner
    .insert(resultSubcategories)
    .values(
      DEFAULT_SUBCATEGORIES.map((seed) => ({
        locationId,
        label: seed.label,
        colorHex: seed.colorHex,
        sortOrder: seed.sortOrder,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: resultSubcategories.id });

  return { created: created.length };
}
