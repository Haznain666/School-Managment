import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { TimetableGrid } from '@/components/academics/TimetableGrid';
import { ChildSelector } from '@/components/parent/ChildSelector';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  getPlacementForStudentProfile,
  listSlotsForSection,
  listTimetableEntries,
} from '@/lib/academics-queries';
import { getActiveAcademicYear, listChildrenForGuardian } from '@/lib/admissions-queries';
import { guardianOwnsStudent } from '@/lib/fee-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Timetable',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A parent's view of one child's week. Sprint 33c, C1.
 *
 * ── The same grid the child sees, reached the parent's way ───────────────
 * `/student/timetable` resolves a section from the uid in the session and has
 * no id in its URL at all, because a pupil has exactly one. A parent has
 * several, so the child travels in `?child=` — and every parent screen in this
 * portal therefore repeats the ownership check rather than trusting the list it
 * came from. That repetition is deliberate and is taken from `/parent/fees`:
 * `listChildrenForGuardian` is a *visibility* boundary and
 * `guardianOwnsStudent` is the authorisation one, and the second is the line
 * between two families.
 *
 * ── The rows are the child's grade's, never the school's ─────────────────
 * `listSlotsForSection`, which resolves the bell schedule this section's grade
 * is assigned to. The unscoped `listTimetableSlots` would lay an infant class
 * out against the senior school's eight rows, five of which can never be
 * filled — CLAUDE.md's standing rule, and the reason the unscoped call is
 * still exported rather than deleted.
 *
 * ── What it does not show, and why ───────────────────────────────────────
 * There is no history and no "as at" control (decision 9). What `0049` changed
 * is that a teacher change no longer rewrites last Tuesday: the grid below is
 * the version of each cell in force **today**, and the version it replaced was
 * closed rather than overwritten. A parent who read this screen in September
 * and reads it again in March is no longer being told that March was always
 * the arrangement.
 */
export default async function ParentTimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['parent']);

  const [profile, activeYear] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    getActiveAcademicYear(locationId),
  ]);

  const children =
    profile === null
      ? []
      : await listChildrenForGuardian(locationId, profile.id, activeYear?.id ?? null);

  const { child: requestedChild } = await searchParams;

  const selected =
    children.find((entry) => entry.studentProfileId === requestedChild) ??
    children[0] ??
    null;

  if (selected === null) {
    return (
      <Shell students={[]} selectedId={null} subtitle={null}>
        <Card>
          <p className="text-sm text-ink-muted">
            No children are recorded against your account yet, so there is no
            timetable to show. Your school admin can link you to your
            child&rsquo;s record.
          </p>
        </Card>
      </Shell>
    );
  }

  // The child came from the guardian's own list, but the check is repeated
  // rather than assumed: it is the one line standing between two families.
  const owns =
    profile !== null &&
    (await guardianOwnsStudent(locationId, profile.id, selected.studentProfileId));

  if (!owns) {
    return (
      <Shell students={children} selectedId={selected.studentProfileId} subtitle={null}>
        <Card>
          <p className="text-sm text-ink-muted">
            That student is not linked to your account.
          </p>
        </Card>
      </Shell>
    );
  }

  const placement =
    activeYear === null
      ? null
      : await getPlacementForStudentProfile(locationId, selected.studentProfileId, activeYear.id);

  if (placement === null || activeYear === null) {
    return (
      <Shell students={children} selectedId={selected.studentProfileId} subtitle={null}>
        <Card>
          <p className="text-sm text-ink-muted">
            {activeYear === null
              ? 'Your school has not opened an academic year yet, so there is no timetable to show.'
              : `No class placement is recorded for ${selected.name} this year, so there is no timetable to show yet.`}
          </p>
        </Card>
      </Shell>
    );
  }

  const [slots, entries] = await Promise.all([
    // This child's own grade's schedule, not the school's whole set of them.
    listSlotsForSection(locationId, placement.sectionId),
    listTimetableEntries(locationId, {
      sectionId: placement.sectionId,
      academicYearId: activeYear.id,
    }),
  ]);

  return (
    <Shell
      students={children}
      selectedId={selected.studentProfileId}
      subtitle={`${placement.gradeName} — ${placement.sectionName} · ${activeYear.name}`}
    >
      <TimetableGrid
        slots={slots}
        entries={entries.map((entry) => ({
          slotId: entry.slotId,
          dayOfWeek: entry.dayOfWeek,
          subjectName: entry.subjectName,
          subjectCode: entry.subjectCode,
          subjectColor: entry.subjectColor,
          subLabel: entry.teacherName,
          room: entry.room,
        }))}
        emptyMessage={`${selected.name}’s class timetable has not been published yet.`}
      />
    </Shell>
  );
}

/**
 * Heading, child switcher, body.
 *
 * One wrapper so that every early return above keeps the switcher. A parent who
 * lands on the child with no placement and loses the control that would take
 * them to the other one has been told, in effect, that the portal is empty.
 */
function Shell({
  students,
  selectedId,
  subtitle,
  children,
}: {
  students: readonly { studentProfileId: string; name: string }[];
  selectedId: string | null;
  subtitle: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description={
          subtitle ?? 'Your child’s periods, teachers and rooms for the week.'
        }
      />

      <ChildSelector
        students={students}
        selectedId={selectedId}
        basePath="/parent/timetable"
      />

      {children}
    </div>
  );
}
