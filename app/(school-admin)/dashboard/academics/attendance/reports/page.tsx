import type { Metadata } from 'next';

import { AttendanceReports } from '@/components/academics/AttendanceReports';
import { BarChart } from '@/components/charts/BarChart';
import { Card, CardTitle } from '@/components/ui/Card';
import { PrincipalScopeNote } from '@/components/school/PrincipalScopeNote';
import { PageHeader } from '@/components/ui/PageHeader';
import { getAttendanceByClass } from '@/lib/dashboard-queries';
import { listAcademicYearOptions } from '@/lib/academics-queries';
import { listGrades, listSections } from '@/lib/admissions-queries';
import { narrowGrades, visibleScopeFor } from '@/lib/principal-visibility';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Attendance reports',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Where this screen marks a class. 75, as the page header says — not the
 * dashboard's 85, which is an earlier warning for a panel of the worst ten.
 */
const ATTENDANCE_CONCERN = 75;

export default async function AttendanceReportsPage() {
  const { claims, locationId } = await requireSchoolPermission('academics.read');

  const [academicYears, allGrades, sections, visible] = await Promise.all([
    listAcademicYearOptions(locationId),
    listGrades(locationId, claims.branchId ?? undefined),
    listSections(locationId, {}),
    // BR4 — Sprint 23, item 3.
    visibleScopeFor({ locationId, role: claims.role, uid: claims.uid }),
  ]);

  const grades = narrowGrades(visible, allGrades);
  const gradeIds = new Set(grades.map((grade) => grade.id));

  /*
   * The school-wide chart is narrowed by the *same* grade list the report below
   * it is narrowed by, rather than by a second rule. `getAttendanceByClass`
   * already takes an `AggregateScope`, which is where the dashboard's own
   * narrowing goes — so a head sees the same classes on the chart and in the
   * table, which is the only arrangement in which the two can be read together.
   */
  const byClass = await getAttendanceByClass(locationId, { gradeIds: visible.gradeIds });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance reports"
        description="A month at a time, per student, with the class average. Below 75% is where most schools intervene."
      />

      <PrincipalScopeNote note={visible.note} />

      {/*
        The school-wide view sits above the per-class report rather than inside
        it: the question "which class has a problem" comes before "which student
        in it does", and answering the first used to require picking each class
        in turn and reading the average off the top of the table.
      */}
      {byClass.length === 0 ? null : (
        <Card
          header={
            <CardTitle
              title="Attendance by class"
              description="Last 30 days. Late counts as present; holidays are excluded."
            />
          }
        >
          {/*
            Horizontal, one row per section. It was vertical, and twenty-nine
            section names under twenty-nine bars at Askari overlapped into one
            unreadable line of text. A row per class gives every name its own
            line, in school order, which is how a head reads down the register.

            `max-w-3xl` because the chart scales its viewBox to its width: at
            the card's full ~1,100px a 29-row chart drew ~1,300px tall with
            19px labels. Capped, the rows are the height of a table row.
          */}
          <BarChart
            title="Attendance rate by class, last 30 days"
            summary={attendanceSummary(byClass)}
            categories={byClass.map((row) => row.label)}
            series={[
              {
                label: 'Attendance',
                values: byClass.map((row) => row.value),
                fillClass: 'fill-chart-1',
                // Below 75% is where most schools intervene, which is what the
                // page header already says, so those bars take the warning
                // colour — the same mark the dashboard's worst-classes chart
                // uses. `attendanceSummary` names how many are below it, so the
                // colour is never the only carrier.
                fillClasses: byClass.map((row) =>
                  row.value < ATTENDANCE_CONCERN ? 'fill-status-warning' : undefined,
                ),
              },
            ]}
            format={(value) => `${Math.round(value)}%`}
            orientation="horizontal"
            className="max-w-3xl"
          />
        </Card>
      )}

      <AttendanceReports
        academicYears={academicYears}
        grades={grades.map((grade) => ({ id: grade.id, label: grade.label }))}
        sections={sections
          .filter((section) => gradeIds.has(section.gradeId))
          .map((section) => ({
            id: section.id,
            gradeId: section.gradeId,
            academicYearId: section.academicYearId,
            name: section.name,
          }))}
      />
    </div>
  );
}

/**
 * One sentence naming the worst class, because that is the actionable half of
 * this chart and a screen-reader user should not have to read twenty bars to
 * find it.
 */
function attendanceSummary(rows: ReadonlyArray<{ label: string; value: number }>): string {
  const worst = rows.reduce((low, row) => (row.value < low.value ? row : low), rows[0]!);
  const below = rows.filter((row) => row.value < ATTENDANCE_CONCERN);

  const average = Math.round(rows.reduce((sum, row) => sum + row.value, 0) / rows.length);

  return below.length === 0
    ? `Averaging ${average}% across ${rows.length} classes, lowest ${worst.label} at ${worst.value}%. None below ${ATTENDANCE_CONCERN}%.`
    : `Averaging ${average}% across ${rows.length} classes. ${below.length} below ${ATTENDANCE_CONCERN}%, lowest ${worst.label} at ${worst.value}%.`;
}
