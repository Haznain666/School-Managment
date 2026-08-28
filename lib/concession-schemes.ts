import 'server-only';

import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';

import {
  concessionSchemeFeeTypes,
  concessionSchemes,
  feeTypes,
  schoolUsers,
  studentConcessionFeeTypes,
  studentConcessions,
  studentProfiles,
} from '@/db/schema';

import { batch, db } from './drizzle';
import { repriceOpenChallans } from './fee-challans';

/**
 * Concession schemes — the discount a school owns (Sprint 18, items 12 and 13).
 *
 * ── A scheme is a decision; a grant is what prices a voucher ─────────────
 * Applying a scheme to a student writes a `student_concessions` row and copies
 * the scheme's name, rate, dates and fee heads onto it. Nothing in the pricing
 * path ever joins back to the scheme.
 *
 * That is not laziness about normalisation. A voucher line freezes its price
 * for the same reason: **a policy edited in March must not rewrite February's
 * slip.** If the calculator read the scheme live, cutting a sibling discount
 * from 20% to 15% would silently re-bill every unpaid voucher in the school,
 * and renaming it would change what a parent's printed copy claims to be.
 * `scheme_id` on the grant is provenance — it answers "which policy is this",
 * which is the question an audit asks and the thing nothing could answer
 * before — and never "how much is it worth".
 *
 * ── An empty head set means every head ───────────────────────────────────
 * Said in the schema, said in the calculator, and said here because this is
 * where a scheme's heads are chosen. `[]` is the **wide** case. STATE.md §5be
 * records what the narrow reading cost the last time somebody made this
 * decision, and the answer must not be re-litigated in a new shape.
 */

export interface ConcessionSchemeRow {
  id: string;
  name: string;
  discountType: 'percentage' | 'fixed';
  discountValue: string;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  notes: string | null;
  /** Empty means every fee head, of every category. */
  feeTypeIds: string[];
  feeTypeNames: string[];
  /** How many students hold a grant that came from this scheme. */
  grantedCount: number;
}

export class ConcessionSchemeError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'ConcessionSchemeError';
    this.code = code;
    this.status = status;
  }
}

/** Every scheme this school has, with its heads and how many hold it. */
export async function listConcessionSchemes(
  locationId: string,
): Promise<ConcessionSchemeRow[]> {
  const schemes = await db
    .select({
      id: concessionSchemes.id,
      name: concessionSchemes.name,
      discountType: concessionSchemes.discountType,
      discountValue: concessionSchemes.discountValue,
      validFrom: concessionSchemes.validFrom,
      validUntil: concessionSchemes.validUntil,
      isActive: concessionSchemes.isActive,
      notes: concessionSchemes.notes,
      // A grouped count rather than one query per scheme: the tab shows it on
      // every row, and a school with a dozen schemes should not cost a dozen
      // round trips to render a list.
      grantedCount: sql<number>`(
        select count(*) from ${studentConcessions}
        where ${studentConcessions.schemeId} = ${concessionSchemes.id}
      )`.mapWith(Number),
    })
    .from(concessionSchemes)
    .where(eq(concessionSchemes.locationId, locationId))
    .orderBy(asc(concessionSchemes.name));

  if (schemes.length === 0) return [];

  const heads = await db
    .select({
      schemeId: concessionSchemeFeeTypes.schemeId,
      feeTypeId: concessionSchemeFeeTypes.feeTypeId,
      feeTypeName: feeTypes.name,
    })
    .from(concessionSchemeFeeTypes)
    .innerJoin(feeTypes, eq(feeTypes.id, concessionSchemeFeeTypes.feeTypeId))
    .where(
      inArray(
        concessionSchemeFeeTypes.schemeId,
        schemes.map((scheme) => scheme.id),
      ),
    )
    .orderBy(asc(feeTypes.sortOrder), asc(feeTypes.name));

  return schemes.map((scheme) => {
    const mine = heads.filter((head) => head.schemeId === scheme.id);
    return {
      ...scheme,
      feeTypeIds: mine.map((head) => head.feeTypeId),
      feeTypeNames: mine.map((head) => head.feeTypeName),
    };
  });
}

/** The fee heads named on a request, checked against this school. */
async function checkFeeTypes(
  locationId: string,
  feeTypeIds: readonly string[],
): Promise<void> {
  if (feeTypeIds.length === 0) return;

  const rows = await db
    .select({ value: count() })
    .from(feeTypes)
    .where(
      and(eq(feeTypes.locationId, locationId), inArray(feeTypes.id, [...feeTypeIds])),
    );

  if ((rows[0]?.value ?? 0) !== feeTypeIds.length) {
    throw new ConcessionSchemeError(
      'invalid_fee_type',
      'One of those fee heads does not exist at this school.',
    );
  }
}

export interface SchemeInput {
  name: string;
  discountType: 'percentage' | 'fixed';
  /** A percentage (0–100) or a flat PKR amount, already validated. */
  discountValue: string;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  notes: string | null;
  /** Empty = every fee head. */
  feeTypeIds: readonly string[];
}

export async function createConcessionScheme(
  locationId: string,
  actorUid: string,
  input: SchemeInput,
): Promise<string> {
  await checkFeeTypes(locationId, input.feeTypeIds);

  const schemeId = crypto.randomUUID();

  try {
    await batch(db, (tx) => [
      tx.insert(concessionSchemes).values({
        id: schemeId,
        locationId,
        name: input.name,
        discountType: input.discountType,
        discountValue: input.discountValue,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        isActive: input.isActive,
        notes: input.notes,
        createdByUid: actorUid,
      }),
      // Heads in the same transaction as the scheme. A scheme that committed
      // without its narrowing would be a *wider* discount than the school
      // chose, applied to every head, and nothing on the screen would say so.
      ...input.feeTypeIds.map((feeTypeId) =>
        tx.insert(concessionSchemeFeeTypes).values({ schemeId, feeTypeId }),
      ),
    ]);
  } catch (error) {
    throw asNameCollision(error, input.name);
  }

  return schemeId;
}

export async function updateConcessionScheme(
  locationId: string,
  schemeId: string,
  input: SchemeInput,
): Promise<void> {
  await checkFeeTypes(locationId, input.feeTypeIds);

  const existing = await db
    .select({ id: concessionSchemes.id })
    .from(concessionSchemes)
    .where(
      and(
        eq(concessionSchemes.id, schemeId),
        eq(concessionSchemes.locationId, locationId),
      ),
    )
    .limit(1);

  if (existing[0] === undefined) {
    throw new ConcessionSchemeError('not_found', 'That scheme is not at this school.', 404);
  }

  try {
    await batch(db, (tx) => [
      tx
        .update(concessionSchemes)
        .set({
          name: input.name,
          discountType: input.discountType,
          discountValue: input.discountValue,
          validFrom: input.validFrom,
          validUntil: input.validUntil,
          isActive: input.isActive,
          notes: input.notes,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(concessionSchemes.id, schemeId),
            eq(concessionSchemes.locationId, locationId),
          ),
        ),
      // Replaced wholesale rather than diffed: the set is at most a dozen rows
      // and a diff is three code paths where one will do.
      tx
        .delete(concessionSchemeFeeTypes)
        .where(eq(concessionSchemeFeeTypes.schemeId, schemeId)),
      ...input.feeTypeIds.map((feeTypeId) =>
        tx.insert(concessionSchemeFeeTypes).values({ schemeId, feeTypeId }),
      ),
    ]);
  } catch (error) {
    throw asNameCollision(error, input.name);
  }
}

/**
 * Deletes a scheme. The grants it made are left standing.
 *
 * `student_concessions.scheme_id` is `ON DELETE SET NULL`, so every child who
 * holds this discount keeps it at the rate they were granted. Deleting a policy
 * the school no longer offers is not the same act as taking money back off four
 * hundred families, and a button that silently did both would be the worst kind
 * of surprise — it would show up as a fee rise on next month's vouchers.
 */
export async function deleteConcessionScheme(
  locationId: string,
  schemeId: string,
): Promise<void> {
  const deleted = await db
    .delete(concessionSchemes)
    .where(
      and(
        eq(concessionSchemes.id, schemeId),
        eq(concessionSchemes.locationId, locationId),
      ),
    )
    .returning({ id: concessionSchemes.id });

  if (deleted[0] === undefined) {
    throw new ConcessionSchemeError('not_found', 'That scheme is not at this school.', 404);
  }
}

function asNameCollision(error: unknown, name: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('concession_schemes_location_name_idx')) {
    return new ConcessionSchemeError(
      'duplicate_name',
      `This school already has a scheme called “${name}”. Use that one, or give this a different name.`,
      409,
    );
  }
  return error;
}

export interface ApplySchemeResult {
  granted: number;
  /** Students who already hold this scheme and were left alone. */
  skipped: number;
  /** Vouchers the repricing moved, across every student granted. */
  repricedVouchers: number;
}

/**
 * Grants a scheme to many students at once.
 *
 * ── Skipping, and why it is reported rather than refused ─────────────────
 * A student who already holds a grant from this scheme is skipped. The picker
 * is a search over the whole school and the natural way to use it is to run it
 * again after admitting three more siblings — so a second apply over an
 * overlapping selection is the *expected* action, not a mistake, and it must
 * not produce a second 20% discount stacking on the first. The count comes back
 * so the screen can say "granted to 3, 14 already had it" instead of implying
 * seventeen new discounts.
 *
 * ── One transaction per student ──────────────────────────────────────────
 * The grant row and its frozen head set commit together or neither does. A
 * grant with no heads is not "the same grant, slightly wrong": it is a discount
 * against **every** fee head instead of the one the school chose.
 *
 * ── Repricing runs once per student, after the grants ────────────────────
 * `repriceOpenChallans` is idempotent with respect to credit
 * (`grantedOverflowPaise`), which is what makes it safe to call as often as it
 * is called — see STATE.md §5be. It is called once per student here rather than
 * once per grant for cost, not for correctness.
 */
export async function applySchemeToStudents(params: {
  locationId: string;
  schemeId: string;
  studentProfileIds: readonly string[];
  actorUid: string;
}): Promise<ApplySchemeResult> {
  const { locationId, schemeId, actorUid } = params;

  const schemeRows = await db
    .select({
      id: concessionSchemes.id,
      name: concessionSchemes.name,
      discountType: concessionSchemes.discountType,
      discountValue: concessionSchemes.discountValue,
      validFrom: concessionSchemes.validFrom,
      validUntil: concessionSchemes.validUntil,
      isActive: concessionSchemes.isActive,
    })
    .from(concessionSchemes)
    .where(
      and(
        eq(concessionSchemes.id, schemeId),
        eq(concessionSchemes.locationId, locationId),
      ),
    )
    .limit(1);

  const scheme = schemeRows[0];
  if (scheme === undefined) {
    throw new ConcessionSchemeError('not_found', 'That scheme is not at this school.', 404);
  }

  if (!scheme.isActive) {
    throw new ConcessionSchemeError(
      'scheme_inactive',
      `“${scheme.name}” is switched off. Turn it back on before granting it to anybody.`,
    );
  }

  // Students are re-read against this school rather than trusted from the
  // request: an id from another tenant must not reach the foreign key.
  const students =
    params.studentProfileIds.length === 0
      ? []
      : await db
          .select({ id: studentProfiles.id })
          .from(studentProfiles)
          .where(
            and(
              eq(studentProfiles.locationId, locationId),
              inArray(studentProfiles.id, [...params.studentProfileIds]),
            ),
          );

  if (students.length === 0) {
    return { granted: 0, skipped: 0, repricedVouchers: 0 };
  }

  const held = await db
    .select({ studentProfileId: studentConcessions.studentProfileId })
    .from(studentConcessions)
    .where(
      and(
        eq(studentConcessions.locationId, locationId),
        eq(studentConcessions.schemeId, schemeId),
        inArray(
          studentConcessions.studentProfileId,
          students.map((student) => student.id),
        ),
      ),
    );

  const alreadyHolding = new Set(held.map((row) => row.studentProfileId));
  const pending = students.filter((student) => !alreadyHolding.has(student.id));

  const heads = await db
    .select({ feeTypeId: concessionSchemeFeeTypes.feeTypeId })
    .from(concessionSchemeFeeTypes)
    .where(eq(concessionSchemeFeeTypes.schemeId, schemeId));

  let granted = 0;

  for (const student of pending) {
    const concessionId = crypto.randomUUID();

    await batch(db, (tx) => [
      tx.insert(studentConcessions).values({
        id: concessionId,
        locationId,
        studentProfileId: student.id,
        schemeId,
        // Frozen, all of it. See this module's docblock.
        concessionName: scheme.name,
        discountType: scheme.discountType,
        discountValue: scheme.discountValue,
        validFrom: scheme.validFrom,
        validUntil: scheme.validUntil,
        approvedByUid: actorUid,
      }),
      ...heads.map((head) =>
        tx.insert(studentConcessionFeeTypes).values({
          studentConcessionId: concessionId,
          feeTypeId: head.feeTypeId,
        }),
      ),
    ]);

    granted += 1;
  }

  let repricedVouchers = 0;

  for (const student of pending) {
    const result = await repriceOpenChallans(db, {
      locationId,
      studentProfileId: student.id,
      actorUid,
    });
    repricedVouchers += result.repriced.length;
  }

  return { granted, skipped: alreadyHolding.size, repricedVouchers };
}

export interface SchemeStudentRow {
  studentProfileId: string;
  studentId: string;
  name: string;
  gradeName: string | null;
  sectionName: string | null;
  /** True when this student already holds a grant from the scheme being applied. */
  alreadyHolds: boolean;
}

/** Who already holds a grant from this scheme, for the picker's tick marks. */
export async function studentsHoldingScheme(
  locationId: string,
  schemeId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ studentProfileId: studentConcessions.studentProfileId })
    .from(studentConcessions)
    .where(
      and(
        eq(studentConcessions.locationId, locationId),
        eq(studentConcessions.schemeId, schemeId),
      ),
    );

  return new Set(rows.map((row) => row.studentProfileId));
}

/** The names behind a set of grants, for the "already holds" line. Unused ids are dropped. */
export async function studentNamesFor(
  locationId: string,
  studentProfileIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (studentProfileIds.length === 0) return result;

  const rows = await db
    .select({ id: studentProfiles.id, name: schoolUsers.name })
    .from(studentProfiles)
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        inArray(studentProfiles.id, [...studentProfileIds]),
      ),
    );

  for (const row of rows) result.set(row.id, row.name);
  return result;
}
