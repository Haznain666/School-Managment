import { and, eq } from 'drizzle-orm';

import { grades, isFeeCategory, type FeeCategory } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { bulkGenerateChallans, countBillableStudents } from '@/lib/challan-generation';
import { db } from '@/lib/drizzle';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/lib/fee-roles';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/challans/bulk-generate
 *
 * GET  a dry run: how many students would be billed, and how many already have
 *      a challan for this period
 * POST raise challans for a whole grade or section
 *
 * The dry run exists because bulk generation is the operation with the largest
 * blast radius in this module — an admin should see "312 students, 0 already
 * billed" before they press the button, not discover it afterwards.
 *
 * The run itself is safe to repeat: students who already have a challan for the
 * period are skipped rather than billed twice, enforced by the unique key on
 * (student, month, year, academic year).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface BulkBody {
  gradeId?: unknown;
  sectionId?: unknown;
  billingMonth?: unknown;
  billingYear?: unknown;
  academicYearId?: unknown;
  dueDate?: unknown;
  categories?: unknown;
}

interface ParsedBulkRequest {
  gradeId: string;
  sectionId: string | null;
  billingMonth: number;
  billingYear: number;
  academicYearId: string;
  dueDate: string | null;
  categories: FeeCategory[] | undefined;
}

/** Shared narrowing for both the dry run and the real thing. */
function parseBulkRequest(
  source: Record<string, unknown>,
): ParsedBulkRequest | { error: string } {
  const gradeId = readString(source['gradeId']);
  const academicYearId = readString(source['academicYearId']);

  if (!isUuid(gradeId)) return { error: 'Select a grade.' };
  if (!isUuid(academicYearId)) return { error: 'Select an academic year.' };

  const sectionIdRaw = readOptionalString(source['sectionId']);
  if (sectionIdRaw !== null && !isUuid(sectionIdRaw)) {
    return { error: 'That section does not exist.' };
  }

  const billingMonth = Number(source['billingMonth']);
  if (!Number.isInteger(billingMonth) || billingMonth < 1 || billingMonth > 12) {
    return { error: 'Select a billing month.' };
  }

  const billingYear = Number(source['billingYear']);
  if (!Number.isInteger(billingYear) || billingYear < 2000 || billingYear > 2100) {
    return { error: 'Select a billing year.' };
  }

  const dueDate = readOptionalString(source['dueDate']);
  if (dueDate !== null && (!ISO_DATE.test(dueDate) || Number.isNaN(Date.parse(dueDate)))) {
    return { error: 'Enter a valid due date.' };
  }

  let categories: FeeCategory[] | undefined;
  const rawCategories = source['categories'];
  if (Array.isArray(rawCategories)) {
    const parsed = rawCategories.filter(isFeeCategory);
    if (parsed.length !== rawCategories.length) {
      return { error: 'One of the fee categories is not valid.' };
    }
    categories = parsed;
  }

  return {
    gradeId,
    sectionId: sectionIdRaw,
    billingMonth,
    billingYear,
    academicYearId,
    dueDate,
    categories,
  };
}

/** The grade must belong to this school — a foreign UUID must not bill anyone. */
async function ownsGrade(locationId: string, gradeId: string): Promise<boolean> {
  const rows = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(eq(grades.id, gradeId), eq(grades.locationId, locationId)))
    .limit(1);

  return rows[0] !== undefined;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const parsed = parseBulkRequest(Object.fromEntries(url.searchParams));

      if ('error' in parsed) {
        return apiFailure('invalid_query', parsed.error, 400);
      }

      if (!(await ownsGrade(auth.locationId, parsed.gradeId))) {
        return apiFailure('not_found', 'That grade does not exist.', 404);
      }

      const counts = await countBillableStudents(db, {
        locationId: auth.locationId,
        gradeId: parsed.gradeId,
        sectionId: parsed.sectionId,
        billingMonth: parsed.billingMonth,
        billingYear: parsed.billingYear,
        academicYearId: parsed.academicYearId,
      });

      return apiSuccess(counts);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
);

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<BulkBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const parsed = parseBulkRequest(body as Record<string, unknown>);
      if ('error' in parsed) {
        return apiFailure('invalid_body', parsed.error, 400);
      }

      if (!(await ownsGrade(auth.locationId, parsed.gradeId))) {
        return apiFailure('not_found', 'That grade does not exist.', 404);
      }

      const result = await bulkGenerateChallans(db, {
        // Tenant comes from the verified session, never from the body.
        locationId: auth.locationId,
        actorUid: auth.uid,
        gradeId: parsed.gradeId,
        sectionId: parsed.sectionId,
        billingMonth: parsed.billingMonth,
        billingYear: parsed.billingYear,
        academicYearId: parsed.academicYearId,
        dueDate: parsed.dueDate,
        ...(parsed.categories === undefined ? {} : { categories: parsed.categories }),
      });

      return apiSuccess({
        generated: result.generated,
        skipped: result.skipped,
        // Itemised rather than collapsed to a count: an admin needs to know
        // *which* students were missed, and why.
        errors: result.errors,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
