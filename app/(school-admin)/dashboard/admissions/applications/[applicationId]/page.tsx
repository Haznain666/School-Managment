import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApplicationReviewCard } from '@/components/admissions/ApplicationReviewCard';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { applicationReference, APPLICATION_STATUS_LABELS } from '@/db/schema';
import {
  getActiveAcademicYear,
  getApplicationDetail,
  listSections,
} from '@/lib/admissions-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

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
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const { applicationId } = await params;
  if (!isUuid(applicationId)) notFound();

  const application = await getApplicationDetail(locationId, applicationId);
  if (application === null) notFound();

  if (claims.branchId !== null && application.branchId !== claims.branchId) notFound();

  const activeYear = await getActiveAcademicYear(locationId);

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

        <span className="font-mono text-xs text-slate-500">
          Ref {applicationReference(application.id)}
        </span>
      </div>

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

        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">Parent or guardian</h3>
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Name" value={application.guardianName} />
            <Detail label="Relationship" value={application.guardianRelationship} />
            <Detail label="Phone" value={application.guardianPhone} />
            <Detail label="Email" value={application.guardianEmail} />
            <Detail label="CNIC" value={application.guardianCnic} />
          </dl>
        </div>

        {application.notes === null ? null : (
          <div className="mt-5 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Notes</h3>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-600">
              {application.notes}
            </p>
          </div>
        )}

        {application.statusReason === null ? null : (
          <div className="mt-5 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Decision reason</h3>
            <p className="mt-2 text-sm text-slate-600">{application.statusReason}</p>
          </div>
        )}

        {application.convertedToStudentProfileId === null ? null : (
          <p className="mt-5 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
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
        <p className="text-sm text-slate-500">
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
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">
        {value === null || value === '' ? '—' : value}
      </dd>
    </div>
  );
}
