import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApplicationReviewCard } from '@/components/admissions/ApplicationReviewCard';
import { SiblingCard } from '@/components/admissions/SiblingCard';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { applicationReference, APPLICATION_STATUS_LABELS } from '@/db/schema';
import {
  getActiveAcademicYear,
  getApplicationDetail,
  listSections,
} from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { listStudentsForGuardianIdentity } from '@/lib/siblings';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Application',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { claims, locationId } = await requireSchoolPermission('admissions.read');

  const { applicationId } = await params;
  if (!isUuid(applicationId)) notFound();

  const application = await getApplicationDetail(locationId, applicationId);
  if (application === null) notFound();

  if (claims.branchId !== null && application.branchId !== claims.branchId) notFound();

  const activeYear = await getActiveAcademicYear(locationId);

  /*
   * Does this school already teach this family?
   *
   * Asked here, on the screen where the offer is decided, because that is the
   * only moment it can change anything — a sibling is why a school waives an
   * admission test, applies the sibling discount or places the child on their
   * brother's campus, and none of that is available once the offer has gone
   * out. Matched on the applicant's own CNIC and phone number, which is the
   * same rule every other sibling surface uses.
   */
  const existingFamily = await listStudentsForGuardianIdentity(locationId, {
    cnic: application.guardianCnic,
    phone: application.guardianPhone,
  });

  // Sections are offered for the active year rather than the year the family
  // applied under: a place is being offered now, not retrospectively.
  const sections =
    application.gradeId === null || activeYear === null
      ? []
      : await listSections(locationId, {
          gradeId: application.gradeId,
          academicYearId: activeYear.id,
        });

  const canReview = claims.role === 'school_admin' || claims.role === 'branch_admin';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard/admissions/applications"
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← All applications
        </Link>

        <span className="font-mono text-xs text-ink-muted">
          Ref {applicationReference(application.id)}
        </span>
      </div>

      <SiblingCard
        siblings={existingFamily}
        title="This family is already at this school"
        description="Students recorded against the same guardian as this application — matched on the CNIC given on the form, or on the phone number. A sibling is worth knowing about before the offer goes out."
        hrefFor={(sibling) =>
          `/dashboard/admissions/students/${sibling.studentProfileId}`
        }
      />

      <Card
        header={
          <CardTitle
            title={application.studentName}
            description={`Submitted ${application.submittedAt.toISOString().slice(0, 10)}`}
            action={
              <Badge
                variant={
                  application.status === 'accepted'
                    ? 'success'
                    : application.status === 'rejected'
                      ? 'danger'
                      : application.status === 'pending'
                        ? 'neutral'
                        : 'warning'
                }
              >
                {APPLICATION_STATUS_LABELS[application.status]}
              </Badge>
            }
          />
        }
      >
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Detail label="Date of birth" value={application.studentDob} />
          <Detail label="Gender" value={application.studentGender} />
          <Detail label="Previous school" value={application.previousSchool} />
          <Detail label="Applying for" value={application.gradeName} />
          <Detail label="Campus" value={application.branchName} />
          <Detail label="Academic year" value={application.academicYearName} />
        </dl>

        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">Parent or guardian</h3>
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Name" value={application.guardianName} />
            <Detail label="Relationship" value={application.guardianRelationship} />
            <Detail label="Phone" value={application.guardianPhone} />
            <Detail label="Email" value={application.guardianEmail} />
            <Detail label="CNIC" value={application.guardianCnic} />
          </dl>
        </div>

        {application.notes === null ? null : (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">Notes</h3>
            <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">
              {application.notes}
            </p>
          </div>
        )}

        {application.statusReason === null ? null : (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">Decision reason</h3>
            <p className="mt-2 text-sm text-ink-muted">{application.statusReason}</p>
          </div>
        )}

        {application.convertedToStudentProfileId === null ? null : (
          <p className="mt-5 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle">
            Enrolled.{' '}
            <Link
              href={`/dashboard/admissions/students/${application.convertedToStudentProfileId}`}
              className="font-medium underline"
            >
              View the student’s profile
            </Link>
            .
          </p>
        )}
      </Card>

      {canReview ? (
        <ApplicationReviewCard
          applicationId={application.id}
          status={application.status}
          statusReason={application.statusReason}
          isConverted={application.convertedToStudentProfileId !== null}
          hasGrade={application.gradeId !== null}
          sections={sections.map((section) => ({
            id: section.id,
            label:
              section.capacity === null
                ? `${section.name} — ${section.studentCount} students`
                : `${section.name} — ${section.studentCount}/${section.capacity} students`,
          }))}
        />
      ) : null}

      {canReview && application.convertedToStudentProfileId === null ? (
        <p className="text-sm text-ink-muted">
          Prefer to adjust the details first?{' '}
          <Link
            href={`/dashboard/admissions/enroll?fromApplication=${application.id}`}
            className="font-medium text-brand-primary hover:underline"
          >
            Open the enrolment form pre-filled from this application
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">
        {value === null || value === '' ? '—' : value}
      </dd>
    </div>
  );
}
