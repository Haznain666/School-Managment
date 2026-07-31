import 'server-only';

import { and, eq } from 'drizzle-orm';

import { schoolUsers } from '@/db/schema';

import type { Database } from './drizzle';
import { InvalidPhoneError, normalizePhone } from './phone';

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
}

export type BootstrapAdminResult =
  | { status: 'created'; userId: string; phone: string }
  /** Someone already holds that number at this school; nothing was changed. */
  | { status: 'exists'; userId: string; phone: string }
  /** Nothing usable was supplied. `reason` is safe to show an operator. */
  | { status: 'skipped'; reason: string };

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
      // `+92` + ten digits and cannot tell a mobile from a landline, so a
      // school's landline *will* be accepted above and simply never receive a
      // WhatsApp passcode. Nothing here can detect that; the operator sees the
      // account on the Users tab and can add a reachable one beside it.
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
      role: 'school_admin',
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
    return { status: 'created', userId: created.id, phone };
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
