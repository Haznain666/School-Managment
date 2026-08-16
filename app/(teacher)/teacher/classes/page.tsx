import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { listTeacherSections } from '@/lib/academics-queries';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { listSectionRoster } from '@/lib/exam-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'My classes',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A teacher's class rosters — who is actually in the room.
 *
 * ── Why a roster is worth its own screen ─────────────────────────────────
 * A teacher can already see their students on the register and on the marks
 * sheet, but only in the act of marking something. "Who is in 5-B, and what is
 * their roll number" is a question asked away from both — filling in a form,
 * seating a class, checking a name before a parents' evening — and the answer
 * was two clicks into a screen that then wanted a date.
 *
 * ── The class list is the authorisation list ─────────────────────────────
 * `listTeacherSections` returns the sections this teacher is timetabled into,
 * and `?section=` can only select among them. A section id from elsewhere falls
 * back to their first class rather than reaching another teacher's roll.
 */
export default async function TeacherClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['teacher']);

  const [profile, activeYear] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    getActiveAcademicYear(locationId),
  ]);

  if (profile === null || activeYear === null) {
    return (
      <div className="space-y-6">
        <Heading />
        <Card>
          <p className="text-sm text-ink-muted">
            {activeYear === null
              ? 'Your school has not opened an academic year yet.'
              : 'Your staff record is still being set up.'}
          </p>
        </Card>
      </div>
    );
  }

  const mySections = await listTeacherSections(locationId, profile.id, activeYear.id);
  const { section: requested } = await searchParams;

  const selected =
    (isUuid(requested)
      ? mySections.find((section) => section.sectionId === requested)
      : undefined) ??
    mySections[0] ??
    null;

  const roster =
    selected === null
      ? []
      : await listSectionRoster(locationId, selected.sectionId, activeYear.id);

  return (
    <div className="space-y-6">
      <Heading />

      {mySections.length === 0 ? (
        <EmptyState
          title={`You are not timetabled into any class for ${activeYear.name}`}
          description="A class appears here once your school puts you on its timetable."
        />
      ) : (
        <>
          {mySections.length > 1 ? (
            <nav aria-label="My classes" className="flex flex-wrap gap-2">
              {mySections.map((section) => {
                const current = section.sectionId === selected?.sectionId;
                return (
                  <Link
                    key={section.sectionId}
                    href={`/teacher/classes?section=${section.sectionId}`}
                    aria-current={current ? 'page' : undefined}
                    className={
                      current
                        ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-onPrimary'
                        : 'rounded-full bg-surface-sunken px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-line'
                    }
                  >
                    {section.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}

          <Card
            header={
              <CardTitle
                title={selected?.label ?? 'Class'}
                description={`${roster.length} student${roster.length === 1 ? '' : 's'} actively enrolled · ${activeYear.name}`}
                action={
                  <div className="flex gap-3">
                    <Link
                      href="/teacher/attendance"
                      className="text-sm font-medium text-brand-primary hover:underline"
                    >
                      Take the register
                    </Link>
                  </div>
                }
              />
            }
            className="p-0"
          >
            {roster.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">
                Nobody is enrolled in this class for {activeYear.name} yet.
              </p>
            ) : (
              <ol className="divide-y divide-line">
                {roster.map((student) => (
                  <li
                    key={student.studentProfileId}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <span
                      aria-hidden="true"
                      className="w-8 shrink-0 text-sm font-medium text-ink-muted"
                    >
                      {student.rollNumber ?? '—'}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{student.studentName}</p>
                      <p className="font-mono text-xs text-ink-muted">
                        {student.studentId}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Heading() {
  return (
    <PageHeader
      title="My classes"
      description="Who is in each class you teach, in register order. Roll numbers first, as they are read out."
    />
  );
}
