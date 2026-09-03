import type { Metadata } from 'next';
import Link from 'next/link';

import { PromotionSheet } from '@/components/exams/PromotionSheet';
import { ResultHistory } from '@/components/exams/ResultHistory';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAcademicYearOptions } from '@/lib/academics-queries';
import {
  getExamSettings,
  getSectionTermResults,
  listAllSectionsForYear,
  listExamTerms,
  listStudentTermHistory,
} from '@/lib/exam-queries';
import { narrowByGrade, visibleScopeFor } from '@/lib/principal-visibility';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Promotions',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageProps {
  searchParams: Promise<{
    section?: string;
    term?: string;
    student?: string;
    academicYearId?: string;
  }>;
}

/**
 * Promotion status for any class in the school.
 *
 * ── Why this exists beside the teacher's own screen ──────────────────────
 * Promotion authority has two independent sources and they are not variations
 * of one thing. A class teacher's comes from `sections.class_teacher_id` and
 * reaches their own classes; a head's comes from `results.promotion` and
 * reaches every class. Sprint 14 shipped only the first, which meant a
 * `student_term_results` row could not come into existence unless a named class
 * teacher pressed **Recompute the class** — so a school that had not named any
 * class teachers got no promotion status on any report card, and no screen
 * anywhere to produce one. QA found it before a school did.
 *
 * The sheet itself is `PromotionSheet`, the same component the teacher uses.
 * Two implementations would be two answers to "what does an override require",
 * and the answer has to be one.
 *
 * ── Heads are exempt from the legacy switch ──────────────────────────────
 * `teachers_can_view_legacy_results` governs teachers. A school admin, branch
 * admin or principal always has full history, so `historyBasePath` is
 * unconditional here where it is conditional on the teacher's page.
 *
 * The page is dynamic for the same reason the criteria screen is: it reads the
 * school's classes, terms and results on every request and could never have
 * been prerendered, so the query parameters cost nothing.
 */
export default async function AdminPromotionsPage({ searchParams }: PageProps) {
  const { locationId, claims } = await requireSchoolPermission('results.promotion');
  // Null for a school admin or principal who runs the whole school; a campus id
  // for a branch admin, whose classes are the only ones they may decide.
  const branchId = claims.branchId;
  const {
    section: requestedSection,
    term: requestedTerm,
    student: requestedStudent,
    academicYearId,
  } = await searchParams;

  const years = await listAcademicYearOptions(locationId);
  const year =
    years.find((row) => row.id === academicYearId) ??
    years.find((row) => row.isActive) ??
    years[0];

  if (year === undefined) {
    return (
      <div className="space-y-6">
        <Heading />
        <EmptyState
          title="No academic year"
          description="A promotion is decided for a term inside a year, so there is nothing here until one exists."
        />
      </div>
    );
  }

  const [allSections, terms, settings, visible] = await Promise.all([
    listAllSectionsForYear(locationId, year.id, branchId),
    listExamTerms(locationId, { academicYearId: year.id }),
    getExamSettings(locationId),
    // BR4 — Sprint 23, item 3. A head's promotion decisions are for their own
    // classes. The empty state below already says "no classes in this
    // session", which is the right sentence for an unassigned head too — and
    // `PrincipalScopeNote` under the heading says who to ask about it.
    visibleScopeFor({ locationId, role: claims.role, uid: claims.uid }),
  ]);

  const sections = narrowByGrade(visible, allSections);

  if (sections.length === 0) {
    return (
      <div className="space-y-6">
        <Heading />
        <EmptyState
          title="No classes in this session"
          description="Promotions are decided per class. Set up classes under Academics first."
        />
      </div>
    );
  }

  const section =
    sections.find((row) => row.sectionId === requestedSection) ?? sections[0];
  const term = terms.find((row) => row.id === requestedTerm) ?? terms[0] ?? null;

  const results =
    term === undefined || term === null || section === undefined
      ? null
      : await getSectionTermResults(locationId, term.id, section.sectionId);

  // `?student=` arrives in a request. Even a head may only inspect a child who
  // is actually in the class on screen — otherwise this page becomes a way to
  // read any child's whole record by guessing a uuid.
  const inspected =
    results === null
      ? null
      : (results.students.find(
          (row) => row.student.studentProfileId === requestedStudent,
        ) ?? null);

  const history =
    inspected === null
      ? []
      : await listStudentTermHistory(locationId, inspected.student.studentProfileId, {
          publishedOnly: false,
        });

  const base = (params: Record<string, string>) => {
    const query = new URLSearchParams({ academicYearId: year.id, ...params });
    return `/dashboard/exams/promotions?${query.toString()}`;
  };

  return (
    <div className="space-y-6">
      <Heading />

      {years.length > 1 ? (
        <Card header={<CardTitle title="Session" />}>
          <nav aria-label="Academic years" className="flex flex-wrap gap-2">
            {years.map((row) => (
              <Chip
                key={row.id}
                href={`/dashboard/exams/promotions?academicYearId=${row.id}`}
                label={row.name}
                current={row.id === year.id}
              />
            ))}
          </nav>
        </Card>
      ) : null}

      <Card header={<CardTitle title="Class" />}>
        <nav aria-label="Classes" className="flex flex-wrap gap-2">
          {sections.map((row) => (
            <Chip
              key={row.sectionId}
              href={base({
                section: row.sectionId,
                ...(term === null ? {} : { term: term.id }),
              })}
              label={`${row.gradeName} ${row.sectionName}`}
              current={row.sectionId === section?.sectionId}
            />
          ))}
        </nav>
      </Card>

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
                href={base({
                  ...(section === undefined ? {} : { section: section.sectionId }),
                  term: row.id,
                })}
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
          historyBasePath={base({
            ...(section === undefined ? {} : { section: section.sectionId }),
            ...(term === null ? {} : { term: term.id }),
          })}
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

function Heading() {
  return (
    <PageHeader
      title="Promotions"
      description="Whether each child moves up, for any class in the school."
      actions={
        <Link
          href="/dashboard/exams"
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          Back to exams
        </Link>
      }
    />
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
