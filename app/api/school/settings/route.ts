import { eq } from 'drizzle-orm';

import { schools } from '@/db/schema';
import {
  apiFailure,
  apiSuccess,
  handleApiError,
  readJsonBody,
} from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import { getSchoolBranding } from '@/lib/school-tenant';
import { readOptionalString } from '@/lib/validation';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/settings
 *
 * GET   the school profile plus active branding
 * PATCH the fields a school owns about itself
 *
 * GET stays open to every signed-in member, because portal layouts call it to
 * populate the navbar — gating that behind a permission would blank the school
 * name for anyone whose role lost `settings.read`.
 *
 * ── What a school may and may not change about itself ────────────────────
 * Editable: phone, email, address, principal name, and — since Sprint 20 —
 * NTN, website and finance email. Those are all contact or identity details the
 * school is the authority on, and making them wait on a support ticket was the
 * complaint that produced this route. The last three are printed on the fee
 * voucher and only when set.
 *
 * Sprint 23 adds an eighth, and it is a different kind of thing: whether a
 * class may have more than one principal. It is a *rule* rather than a detail,
 * but it passes the same test — it is a decision about how this school is run,
 * it is school-wide rather than per campus, and nothing outside the school
 * depends on it. It is also the only non-string field here, which is why it is
 * read separately from the loop below rather than through `readOptionalString`.
 *
 * Not editable here, at any permission: `name`, `slug`, `school_code`, `city`
 * and `is_active`. The slug is the hostname the tenant resolves on, the school
 * code prefixes every student ID and every challan and payslip number already
 * issued, and `is_active` is a billing decision. A school changing its own code
 * mid-year would make new documents disagree with the ones in its filing
 * cabinet — so those stay with the platform operator.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const rows = await db
        .select({
          id: schools.id,
          name: schools.name,
          slug: schools.slug,
          city: schools.city,
          address: schools.address,
          phone: schools.phone,
          email: schools.email,
          principalName: schools.principalName,
          isActive: schools.isActive,
        })
        .from(schools)
        .where(eq(schools.locationId, auth.locationId))
        .limit(1);

      const school = rows[0];
      if (school === undefined) {
        return apiFailure('not_found', 'School not found.', 404);
      }

      const branding = await getSchoolBranding(auth.locationId);

      return apiSuccess({
        school,
        branding: {
          logoUrl: branding?.logoUrl ?? null,
          palette: branding?.palette ?? null,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);

interface UpdateSettingsBody {
  phone?: unknown;
  email?: unknown;
  address?: unknown;
  principalName?: unknown;
  ntn?: unknown;
  website?: unknown;
  financeEmail?: unknown;
  allowSharedPrincipalGrades?: unknown;
}

/**
 * The seven fields a school owns about itself. See the note at the top.
 *
 * `ntn`, `website` and `financeEmail` joined the list in Sprint 20 (decision
 * D4): all three are printed on the fee voucher and all three are facts the
 * school is the authority on, which is the same test the first four pass.
 */
const EDITABLE_FIELDS = [
  'phone',
  'email',
  'address',
  'principalName',
  'ntn',
  'website',
  'financeEmail',
] as const;

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<UpdateSettingsBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof schools.$inferInsert> = {};

      for (const field of EDITABLE_FIELDS) {
        if (body[field] === undefined) continue;

        const value = readOptionalString(body[field]);
        if (value !== null && value.length > 200) {
          return apiFailure('invalid_body', 'That value is too long.', 400);
        }
        updates[field] = value;
      }

      /*
       * Sprint 23, item 2 — the eighth editable field, and the first that is
       * not a string.
       *
       * It is read outside the loop above rather than being wedged into it:
       * `readOptionalString` would turn `false` into the string "false", which
       * is truthy, and a school turning the rule *off* would be turning it on.
       * A strict `typeof` test also means an absent key and an explicit
       * `false` are read differently, which matters because every other field
       * on this route treats absent as "leave it alone".
       *
       * It belongs in Settings rather than beside the assignments on the branch
       * page: it is one rule for the whole school, and the branch card is about
       * one campus.
       *
       * ── Written here, and deliberately never read back here ────────────
       * The column arrives in migration `0039`, and this route's **GET** is
       * called by every portal layout to fill the navbar. Selecting a column
       * that does not exist yet would blank every portal in the window between
       * the code deploying and the migration running — for a value only the
       * Settings page needs, and that page reads it server-side from `schools`
       * directly. So the write is here and neither read is.
       * `SPRINT-23-DDL-NOTES.md` records this as the deploy-order mitigation.
       */
      if (body.allowSharedPrincipalGrades !== undefined) {
        if (typeof body.allowSharedPrincipalGrades !== 'boolean') {
          return apiFailure(
            'invalid_body',
            'Whether a class may have more than one principal is a yes or a no.',
            400,
          );
        }
        updates.allowSharedPrincipalGrades = body.allowSharedPrincipalGrades;
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      // Scoped to the session's tenant, so there is no school id to tamper with.
      const updated = await db
        .update(schools)
        .set(updates)
        .where(eq(schools.locationId, auth.locationId))
        .returning({ id: schools.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'School not found.', 404);
      }

      const rows = await db
        .select({
          name: schools.name,
          city: schools.city,
          address: schools.address,
          phone: schools.phone,
          email: schools.email,
          principalName: schools.principalName,
          ntn: schools.ntn,
          website: schools.website,
          financeEmail: schools.financeEmail,
        })
        .from(schools)
        .where(eq(schools.locationId, auth.locationId))
        .limit(1);

      return apiSuccess({ school: rows[0] ?? null });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'settings.write' },
);
