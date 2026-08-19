import type { Metadata } from 'next';
import Link from 'next/link';

import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  listPeriodStructures,
  listSubjects,
  listTimetableSlots,
} from '@/lib/academics-queries';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Academics',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function StatCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
    </Card>
  );
}

function ActionTile({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-card border border-line bg-surface-raised p-4 shadow-card transition hover:border-brand-primary"
    >
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
    </Link>
  );
}

/**
 * Academics overview.
 *
 * Every count is scoped to the caller's own school — the location id comes from
 * their verified session, so there is no request parameter that could widen it
 * to another tenant.
 */
export default async function AcademicsOverviewPage() {
  const { locationId } = await requireSchoolPermission('academics.read');

  const [subjects, slots, structures, activeYear] = await Promise.all([
    listSubjects(locationId, { activeOnly: true }),
    // Deliberately unscoped: this is a count across every schedule the school
    // keeps, which is what a summary card means by "periods".
    listTimetableSlots(locationId, { activeOnly: true }),
    listPeriodStructures(locationId, { activeOnly: true }),
    getActiveAcademicYear(locationId),
  ]);

  const teachingSlots = slots.filter((slot) => !slot.isBreak);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academics"
        description="What the school teaches, when it teaches it, and who was there."
      />

      {activeYear === null ? (
        <Card>
          <h3 className="text-base font-semibold text-ink">
            No active academic year
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            Timetables and registers are both filed against a year, so nothing
            here can be set up until one is active.
          </p>
          <Link
            href="/dashboard/admissions/academic-years"
            className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up an academic year
          </Link>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Subjects"
          value={subjects.length}
          hint="Active subjects the school teaches"
        />
        <StatCard
          label="Teaching periods"
          value={teachingSlots.length}
          hint={
            structures.length > 1
              ? `Across ${structures.length} period schedules`
              : `${slots.length - teachingSlots.length} break${slots.length - teachingSlots.length === 1 ? '' : 's'} in the day`
          }
        />
        <StatCard
          label="Academic year"
          value={activeYear === null ? 0 : 1}
          hint={activeYear === null ? 'None active' : activeYear.name}
        />
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Quick actions
        </h3>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ActionTile
            href="/dashboard/academics/subjects"
            title="Subjects"
            description="What the school teaches, and the colour each takes in the grid."
          />
          <ActionTile
            href="/dashboard/academics/timetable"
            title="Timetable"
            description="Build a section's week, and the period schedules its rows come from."
          />
          <ActionTile
            href="/dashboard/academics/teacher-calendar"
            title="Teacher calendar"
            description="One teacher's day, week or month, with the gaps visible."
          />
          <ActionTile
            href="/dashboard/academics/attendance"
            title="Mark attendance"
            description="Take today's register for a class."
          />
          <ActionTile
            href="/dashboard/academics/attendance/reports"
            title="Attendance reports"
            description="A month of attendance per student, with class averages."
          />
        </div>
      </section>
    </div>
  );
}
