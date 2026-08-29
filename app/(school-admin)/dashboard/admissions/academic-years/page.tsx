import type { Metadata } from 'next';
import Link from 'next/link';

import { AcademicYearTable } from '@/components/admissions/AcademicYearTable';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  getActiveAcademicYear,
  getMarkedActiveAcademicYear,
  listAcademicYears,
} from '@/lib/admissions-queries';
import { effectiveBranchIds, resolveBranchScope } from '@/lib/branch-scope';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Academic years',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The school's calendar — Sprint 19b, item 14.
 *
 * ── The Campus column, and why an empty one is a sentence ───────────────
 * A year with no `academic_year_branches` rows runs everywhere, which is every
 * year that existed before this sprint. The column therefore prints "All
 * campuses" rather than a dash: an empty cell on a screen where the other rows
 * name campuses reads as a year nobody runs, and the first thing an
 * administrator would do about that is create a duplicate.
 *
 * The campus **filter** is a `DataTable` facet rather than a `?branch=`
 * navigation, unlike every other campus control in the product. That is
 * deliberate and is the one place the two differ: the scope has already decided
 * which years this person may see, on the server, and the facet is a way to
 * read a list of at most a few dozen rows. Sending the whole page back for it
 * would cost ~1s to filter something already on screen.
 *
 * ── `getMarkedActiveAcademicYear`, not `getActiveAcademicYear` ──────────
 * The table offers *Set as active* on every year that does not carry the flag,
 * including the one that is current only because today falls inside it. Reading
 * the calendar fallback here would hide the button on a year nobody has
 * confirmed, which is the state a fresh run leaves a school in.
 */
export default async function AcademicYearsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string | string[] }>;
}) {
  const { claims, locationId, permissions } =
    await requireSchoolPermission('admissions.read');

  const requested = (await searchParams).branch;
  const scope = await resolveBranchScope(
    locationId,
    claims,
    Array.isArray(requested) ? requested[0] : requested,
  );

  const [years, markedActive, resolvedActive] = await Promise.all([
    listAcademicYears(locationId, effectiveBranchIds(scope)),
    getMarkedActiveAcademicYear(locationId),
    getActiveAcademicYear(locationId),
  ]);

  /*
   * The year that is current *only* because today falls inside it — item 14c.
   *
   * Null the moment anybody has marked one, because then the flag is the
   * answer and the calendar never gets asked. Surfaced on the table so that a
   * school reading "Inactive" against every row can see which session the rest
   * of the product is nonetheless using, rather than concluding it is using
   * none.
   */
  const currentByCalendarId = markedActive === null ? (resolvedActive?.id ?? null) : null;

  /*
   * The controls follow the permission, not the role.
   *
   * This was `claims.role === 'school_admin'`, which had drifted from the
   * routes it guards — POST, PATCH and the activate endpoint all accept
   * `admissions.write`, so a principal holding it could already create a year
   * through the API while the screen hid the button. A control that is hidden
   * but not enforced is the wrong half of the pair to keep; §5bf records the
   * same correction on the student profile.
   */
  const canEdit = permissions.includes('admissions.write');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic years"
        description="Every enrollment, section and student ID belongs to a year. Exactly one is active at a time, and that is the one new admissions go into."
        actions={
          canEdit ? (
            <Link href="/dashboard/admissions/academic-years/new">
              <Button>Create academic years</Button>
            </Link>
          ) : null
        }
      />

      <AcademicYearTable
        years={years}
        canEdit={canEdit}
        currentByCalendarId={currentByCalendarId}
      />
    </div>
  );
}
