import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { grades } from '@/db/schema/grades';
import { sections } from '@/db/schema/sections';

import { db } from './drizzle';

/**
 * Every grade has a class in it.
 *
 * ── The state this fixes ─────────────────────────────────────────────────
 * A grade with no section is a rung nobody can be enrolled into: enrolment
 * places a child in a *section*, the timetable is built per section, and the
 * class teacher hangs off one. So a freshly seeded ladder — sixteen grades and
 * no sections — is a school that cannot admit anybody until somebody notices
 * the second, undocumented step and repeats it sixteen times.
 *
 * Section A, capacity 35, is what a Pakistani school opens a class with. A
 * school that runs A and B adds B; a school that calls its classes Blue and
 * Green renames A. Neither is worse off than starting from nothing, and both
 * are one edit rather than sixteen.
 *
 * ── Why it is a function and not a trigger or a default ──────────────────
 * Sections are per *year*: the same grade needs one for 2026-27 and another for
 * 2027-28, and last year's enrolments must keep pointing at last year's rows.
 * That is a fact about two tables, so it lives where both are visible — and it
 * is idempotent, so every caller may call it without asking whether somebody
 * already has.
 */

/** What a school's first class in a grade is called. */
export const DEFAULT_SECTION_NAME = 'A';

/** How many children it holds until the school says otherwise. */
export const DEFAULT_SECTION_CAPACITY = 35;

export interface EnsureDefaultSectionsInput {
  locationId: string;
  /** The year the sections belong to. */
  academicYearId: string;
  /** One campus, or every campus of the school when omitted. */
  branchId?: string | undefined;
}

/**
 * Creates Section A for every grade that has no section in this year.
 *
 * Returns how many were created, which is zero on every call after the first —
 * the read finds nothing, and the `ON CONFLICT` on
 * `(grade_id, academic_year_id, name)` is the second guard for the case two
 * callers arrive at once. A grade that already has *any* section is left alone:
 * a school that deleted A and created "Blue" has answered this question, and
 * putting A back would be the product arguing with them.
 */
export async function ensureDefaultSections(
  input: EnsureDefaultSectionsInput,
): Promise<number> {
  const missing = await db
    .select({ id: grades.id })
    .from(grades)
    .leftJoin(
      sections,
      and(
        eq(sections.gradeId, grades.id),
        eq(sections.academicYearId, input.academicYearId),
      ),
    )
    .where(
      and(
        eq(grades.locationId, input.locationId),
        input.branchId === undefined ? undefined : eq(grades.branchId, input.branchId),
        isNull(sections.id),
      ),
    );

  if (missing.length === 0) return 0;

  const created = await db
    .insert(sections)
    .values(
      missing.map((grade) => ({
        locationId: input.locationId,
        gradeId: grade.id,
        academicYearId: input.academicYearId,
        name: DEFAULT_SECTION_NAME,
        capacity: DEFAULT_SECTION_CAPACITY,
      })),
    )
    .onConflictDoNothing({
      target: [sections.gradeId, sections.academicYearId, sections.name],
    })
    .returning({ id: sections.id });

  return created.length;
}
