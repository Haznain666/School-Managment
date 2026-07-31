import type { Metadata } from 'next';

import { PlaceholderModuleCard } from '@/components/school/PlaceholderModuleCard';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import {
  getActiveAcademicYear,
  getCurrentEnrollment,
  getStudentBySchoolUserId,
} from '@/lib/admissions-queries';
import { getStudentFeeSummary } from '@/lib/fee-queries';
import { formatPkr, toPaise } from '@/lib/money';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Student dashboard',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The student's own dashboard.
 *
 * Everything shown is looked up from the uid in their verified session, so a
 * student can only ever see their own record — there is no id in the URL that
 * could be changed to somebody else's.
 */
export default async function StudentDashboardPage() {
  const { claims, locationId } = await requireSchoolRole(['student']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const firstName = (profile?.name ?? '').split(' ')[0] ?? '';

  const [student, activeYear] =
    profile === null
      ? [null, null]
      : await Promise.all([
          getStudentBySchoolUserId(locationId, profile.id),
          getActiveAcademicYear(locationId),
        ]);

  const [enrollment, feeSummary] = await Promise.all([
    student === null || activeYear === null
      ? Promise.resolve(null)
      : getCurrentEnrollment(locationId, student.studentProfileId, activeYear.id),
    student === null
      ? Promise.resolve(null)
      : getStudentFeeSummary(locationId, student.studentProfileId),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Welcome{firstName === '' ? '' : `, ${firstName}`}.
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {student === null
                ? 'Your student record is still being set up. Your class details will appear here once your school completes your enrolment.'
                : 'Your timetable, results and fee status will appear here as your school enables each module.'}
            </p>
          </div>

          {student === null ? null : (
            <Badge variant="neutral">
              <span className="font-mono">{student.studentId}</span>
            </Badge>
          )}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card header={<CardTitle title="My class" />}>
          {enrollment === null ? (
            <p className="text-sm text-slate-500">
              {activeYear === null
                ? 'Your school has not opened an academic year yet.'
                : `No placement is recorded for you in ${activeYear.name}.`}
            </p>
          ) : (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Grade" value={enrollment.gradeName} />
              <Detail label="Section" value={enrollment.sectionName} />
              <Detail label="Academic year" value={enrollment.academicYearName} />
              <Detail label="Roll number" value={enrollment.rollNumber ?? '—'} />
              {enrollment.branchName === null ? null : (
                <Detail label="Campus" value={enrollment.branchName} />
              )}
            </dl>
          )}
        </Card>

        <PlaceholderModuleCard
          icon="🗓️"
          title="Today's Schedule"
          moduleName="Academics"
          description="Your periods, rooms and teachers for today."
        />
        <PlaceholderModuleCard
          icon="📈"
          title="My Grades"
          moduleName="Academics"
          description="Results by subject and term."
        />
        <Card header={<CardTitle title="Fee balance" />}>
          {feeSummary === null ? (
            <p className="text-sm text-slate-500">
              Your fee details appear once your enrolment is complete.
            </p>
          ) : (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Outstanding
              </p>
              <p
                className={
                  toPaise(feeSummary.balance) > 0
                    ? 'mt-1 text-2xl font-bold text-red-600'
                    : 'mt-1 text-2xl font-bold text-slate-900'
                }
              >
                {formatPkr(feeSummary.balance)}
              </p>

              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
                <Detail label="Billed" value={formatPkr(feeSummary.billed)} />
                <Detail label="Paid" value={formatPkr(feeSummary.paid)} />
              </dl>

              {feeSummary.oldestUnpaid === null ? null : (
                <p className="mt-3 text-xs text-slate-500">
                  Oldest unpaid challan{' '}
                  <span className="font-mono">
                    {feeSummary.oldestUnpaid.challanNumber}
                  </span>
                  , due {feeSummary.oldestUnpaid.dueDate}.
                </p>
              )}

              <p className="mt-3 text-xs text-slate-500">
                Contact your school admin for payment — fees cannot be paid
                through this portal.
              </p>
            </>
          )}
        </Card>
      </div>

      <Card header={<CardTitle title="Announcements" />}>
        <p className="text-sm text-slate-500">
          School announcements will appear here.
        </p>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}
