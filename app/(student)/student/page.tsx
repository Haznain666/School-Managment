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
import { formatPkr } from '@/lib/money';
import { requireSchoolRole } from '@/lib/school-guard';
import { getModuleFlags, getSchoolUserByUid } from '@/lib/school-queries';

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

  const [enrollment, moduleFlags] = await Promise.all([
    student === null || activeYear === null
      ? Promise.resolve(null)
      : getCurrentEnrollment(locationId, student.studentProfileId, activeYear.id),
    getModuleFlags(locationId),
  ]);

  // Only read fees when the school has the module — a student at a school that
  // does not bill through the platform should see the placeholder, not a zero.
  const feeSummary =
    student === null || !moduleFlags.fee_management
      ? null
      : await getStudentFeeSummary(
          locationId,
          student.studentProfileId,
          activeYear?.id ?? null,
        );

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
        {moduleFlags.fee_management && feeSummary !== null ? (
          <Card header={<CardTitle title="Fee balance" />}>
            <p
              className={`text-2xl font-bold ${
                feeSummary.outstandingPaise > 0 ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              PKR {formatPkr(feeSummary.outstandingPaise)}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {feeSummary.outstandingPaise === 0
                ? 'Nothing outstanding.'
                : feeSummary.nextDue === null
                  ? 'Outstanding across your challans.'
                  : `Next due ${feeSummary.nextDue.dueDate} · challan ${feeSummary.nextDue.challanNumber}`}
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Contact the school office to pay. Payments are recorded there once
              received.
            </p>
          </Card>
        ) : (
          <PlaceholderModuleCard
            icon="💳"
            title="Fee Balance"
            moduleName="Fee Management"
            description="What is due, what is paid, and when."
          />
        )}
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
