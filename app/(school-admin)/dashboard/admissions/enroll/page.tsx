import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { StudentEnrollForm, type EnrollPrefill } from '@/components/admissions/StudentEnrollForm';
import { Card } from '@/components/ui/Card';
import { schools } from '@/db/schema';
import {
  getActiveAcademicYear,
  getApplicationDetail,
  listAdmissionsBranches,
} from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { MAX_GUARDIANS } from '@/lib/enrollment';
import { requireSchoolPermission } from '@/lib/school-guard';
import { previewNextStudentId } from '@/lib/student-id';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Enrol student',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Direct enrolment.
 *
 * `?fromApplication=<id>` pre-fills the form from an accepted application, for
 * the case where an admin would rather adjust the details than convert
 * blindly. The application is re-read here from the database rather than
 * carried in query parameters — the id is the only thing trusted from the URL,
 * and it is scoped to this school before anything is shown.
 */
export default async function EnrollStudentPage({
  searchParams,
}: {
  searchParams: Promise<{ fromApplication?: string }>;
}) {
  const { claims, locationId } = await requireSchoolPermission('admissions.write');

  const [branches, activeYear, schoolRows] = await Promise.all([
    listAdmissionsBranches(locationId),
    getActiveAcademicYear(locationId),
    db
      .select({ schoolCode: schools.schoolCode })
      .from(schools)
      .where(eq(schools.locationId, locationId))
      .limit(1),
  ]);

  const schoolCode = schoolRows[0]?.schoolCode ?? null;

  if (activeYear === null) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">
          No active academic year
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Students are enrolled into an academic year, and their IDs are numbered
          per year, so one has to exist first.
        </p>
        <Link
          href="/dashboard/admissions/academic-years/new"
          className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
        >
          Set up an academic year
        </Link>
      </Card>
    );
  }

  if (schoolCode === null || schoolCode === '') {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">No school code set</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Student IDs are built from a short school code, e.g.{' '}
          <span className="font-mono">GVS-{activeYear.startYear}-0001</span>. Ask
          the platform administrator to set one for this school before enrolling.
        </p>
      </Card>
    );
  }

  const visibleBranches =
    claims.branchId === null
      ? branches
      : branches.filter((branch) => branch.id === claims.branchId);

  const { fromApplication } = await searchParams;

  let prefill: EnrollPrefill | undefined;

  if (fromApplication !== undefined && isUuid(fromApplication)) {
    const application = await getApplicationDetail(locationId, fromApplication);

    if (application !== null && application.convertedToStudentProfileId === null) {
      prefill = {
        studentName: application.studentName,
        studentDob: application.studentDob,
        studentGender: application.studentGender,
        previousSchool: application.previousSchool,
        guardianName: application.guardianName,
        guardianRelationship: application.guardianRelationship,
        guardianPhone: application.guardianPhone,
        guardianEmail: application.guardianEmail,
        guardianCnic: application.guardianCnic,
        branchId: application.branchId,
        gradeId: application.gradeId,
      };
    }
  }

  const studentIdPreview = await previewNextStudentId(
    db,
    locationId,
    activeYear.id,
    schoolCode,
  );

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-ink">Enrol a student</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Creates the student’s record, their placement for {activeYear.name} and
          their guardians, then mirrors them into GoHighLevel.
        </p>
      </div>

      {prefill === undefined ? null : (
        <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle">
          Pre-filled from an accepted application. Check the details before
          submitting — anything you change here is what gets stored.
        </p>
      )}

      <StudentEnrollForm
        branches={visibleBranches}
        academicYearId={activeYear.id}
        academicYearName={activeYear.name}
        studentIdPreview={studentIdPreview}
        maxGuardians={MAX_GUARDIANS}
        prefill={prefill}
      />
    </div>
  );
}
