import type { Metadata } from 'next';
import Link from 'next/link';

import { PromotionSheet } from '@/components/exams/PromotionSheet';
import { ResultHistory } from '@/components/exams/ResultHistory';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  getExamSettings,
  getSectionTermResults,
  listClassTeacherSections,
  listExamTerms,
  listStudentTermHistory,
} from '@/lib/exam-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { staffIdForSchoolUser } from '@/lib/staff-self-queries';

export const metadata: Metadata = {
  title: 'Promotions',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageProps {
  searchParams: Promise<{ section?: string; term?: string; student?: string }>;
}

/**
 * The class teacher's promotion screen.
 *
 * ── Refused, not hidden ──────────────────────────────────────────────────
 * A teacher who is the class teacher of nothing gets this page's refusal as
 * well as having the nav entry absent. A link is not a permission, and a typed
 * URL would otherwise walk straight in — the same reasoning as the exams module
 * gate in the admin portal.
 *
 * ── Authority is per section, not per role ───────────────────────────────
 * `sections.class_teacher_id` is what makes this teacher's own classes theirs,
 * which is why `results.promotion` is deliberately not granted to `teacher`. A
 * role key would hand every teacher in the school every class in it. The API
 * checks the same thing again — this page decides what renders, the route is
 * what protects the data.
 */
export default async function TeacherPromotionsPage({ searchParams }: PageProps) {
  const { claims, locationId } = await requireSchoolRole(['teacher']);
  const {
    section: requestedSection,
    term: requestedTerm,
    student: requestedStudent,
  } = await searchParams;

  const profile = await getSchoolUserByUid(locationId, claims.uid);
  const staffId =
    profile === null ? null : await staffIdForSchoolUser(locationId, profile.id);

  const sections =
    staffId === null ? [] : await listClassTeacherSections(locationId, staffId);

  if (sections.length === 0) {
    return (
      <div className="space-y-6">
        <Heading />
        <EmptyState
          title="You are not a class teacher"
          description="Promotion decisions belong to the teacher named as a class's class teacher. If that should be you, your school office sets it on the class."
        />
      </div>
    );
  }

  const section =
    sections.find((row) => row.sectionId === requestedSection) ?? sections[0];
  if (section === undefined) {
    return (
      <div className="space-y-6">
        <Heading />
        <EmptyState title="You are not a class teacher" description="" />
      </div>
    );
  }

  const terms = await listExamTerms(locationId, {
    academicYearId: section.academicYearId,
  });
  const term = terms.find((row) => row.id === requestedTerm) ?? terms[0] ?? null;

  const [results, settings] = await Promise.all([
    term === null
      ? Promise.resolve(null)
      : getSectionTermResults(locationId, term.id, section.sectionId),
    getExamSettings(locationId),
  ]);

  const historyBasePath = settings.teachersCanViewLegacyResults
    ? `/teacher/promotions?section=${section.sectionId}${term === null ? '' : `&term=${term.id}`}`
    : null;

  // The child has to be in the class the teacher owns. `?student=` is a
  // request parameter, and a profile id from elsewhere would otherwise read
  // another teacher's class through this teacher's page.
  const inspected =
    historyBasePath === null || results === null
      ? null
      : (results.students.find(
          (row) => row.student.studentProfileId === requestedStudent,
        ) ?? null);

  const history =
    inspected === null
      ? []
      : await listStudentTermHistory(
          locationId,
          inspected.student.studentProfileId,
          { publishedOnly: false },
        );

  return (
    <div className="space-y-6">
      <Heading />

      {sections.length > 1 ? (
        <Card header={<CardTitle title="Class" />}>
          <nav aria-label="Classes" className="flex flex-wrap gap-2">
            {sections.map((row) => (
              <Chip
                key={row.sectionId}
                href={`/teacher/promotions?section=${row.sectionId}${term === null ? '' : `&term=${term.id}`}`}
                label={`${row.gradeName} ${row.sectionName}`}
                current={row.sectionId === section.sectionId}
              />
            ))}
          </nav>
        </Card>
      ) : null}

      {terms.length === 0 ? (
        <EmptyState
          title="No terms in this session"
          description="A promotion is decided for a term, so there is nothing here until the school opens one."
        />
      ) : (
        <Card header={<CardTitle title="Term" />}>
          <nav aria-label="Terms" className="flex flex-wrap gap-2">
            {terms.map((row) => (
              <Chip
                key={row.id}
                href={`/teacher/promotions?section=${section.sectionId}&term=${row.id}`}
                label={row.name}
                current={row.id === term?.id}
              />
            ))}
          </nav>
        </Card>
      )}

      {results === null ? null : (
        <PromotionSheet
          results={results}
          canDecide
          historyBasePath={historyBasePath}
        />
      )}

      {inspected === null ? null : (
        <ResultHistory
          history={history}
          colorCodingEnabled={settings.colorCodingEnabled}
          studentName={inspected.student.studentName}
        />
      )}
    </div>
  );
}

function Chip({
  href,
  label,
  current,
}: {
  href: string;
  label: string;
  current: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={
        current
          ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-onPrimary'
          : 'rounded-full bg-surface-sunken px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-line'
      }
    >
      {label}
    </Link>
  );
}

function Heading() {
  return (
    <PageHeader
      title="Promotions"
      description="Your class's term, what the rules decided, and the change you can make to it."
    />
  );
}
