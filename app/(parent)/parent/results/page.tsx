import type { Metadata } from 'next';
import Link from 'next/link';

import { ChildSelector } from '@/components/parent/ChildSelector';
import { ReportCardSummary } from '@/components/parent/ReportCardSummary';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getActiveAcademicYear, listChildrenForGuardian } from '@/lib/admissions-queries';
import { getStudentReportCard, listPublishedTermsForStudent } from '@/lib/portal-results';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Results',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A parent's view of their children's report cards.
 *
 * ── Only published terms reach this page ─────────────────────────────────
 * `lib/portal-results.ts` refuses everything else, and refuses it with the same
 * answer whether the term is unpublished, belongs to another school or is one
 * the child was never in. Distinguishing those would tell a family which terms
 * exist at a school they are not part of.
 *
 * ── The card on screen is the card on paper ──────────────────────────────
 * `ReportCardDocument` is the same component the school's own print page
 * renders. A parent querying a grade and a school looking at the sheet must be
 * looking at one document — a second rendering of the same marks is how the two
 * come to disagree about a total.
 */
export default async function ParentResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; term?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['parent']);
  const profile = await getSchoolUserByUid(locationId, claims.uid);

  const activeYear = await getActiveAcademicYear(locationId);
  const children =
    profile === null
      ? []
      : await listChildrenForGuardian(locationId, profile.id, activeYear?.id ?? null);

  const { child: requestedChild, term: requestedTerm } = await searchParams;

  const selected =
    children.find((entry) => entry.studentProfileId === requestedChild) ??
    children[0] ??
    null;

  if (selected === null) {
    return (
      <div className="space-y-6">
        <Heading />
        <Card>
          <p className="text-sm text-ink-muted">
            No children are recorded against your account yet, so there are no
            results to show.
          </p>
        </Card>
      </div>
    );
  }

  const terms = await listPublishedTermsForStudent(locationId, selected.studentProfileId);
  const term =
    terms.find((row) => row.termId === requestedTerm) ?? terms[0] ?? null;

  const card =
    term === null
      ? null
      : await getStudentReportCard(locationId, term.termId, selected.studentProfileId);

  return (
    <div className="space-y-6">
      <Heading />

      <ChildSelector
        students={children}
        selectedId={selected.studentProfileId}
        basePath="/parent/results"
      />

      {terms.length === 0 ? (
        <EmptyState
          title="No results have been published yet"
          description={`When ${selected.name}'s school publishes a term's results, the report card appears here and can be printed.`}
        />
      ) : (
        <>
          <Card
            header={
              <CardTitle
                title="Term"
                description="Only terms your school has published appear here."
              />
            }
          >
            <nav aria-label="Terms" className="flex flex-wrap gap-2">
              {terms.map((row) => {
                const current = row.termId === term?.termId;
                return (
                  <Link
                    key={row.termId}
                    href={`/parent/results?child=${selected.studentProfileId}&term=${row.termId}`}
                    aria-current={current ? 'page' : undefined}
                    className={
                      current
                        ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-onPrimary'
                        : 'rounded-full bg-surface-sunken px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-line'
                    }
                  >
                    {row.termName}
                    <span className="ml-1.5 opacity-70">{row.academicYearName}</span>
                  </Link>
                );
              })}
            </nav>
          </Card>

          {card === null || term === null ? (
            <Card>
              <p className="text-sm text-ink-muted">
                No report card is available for {selected.name} in that term.
              </p>
            </Card>
          ) : (
            <>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-ink-muted">
                    {card.termName} · {card.gradeName} {card.sectionName}
                  </p>

                  {/* A new tab, so the term the parent is reading survives the
                      print dialog — the same rule the challan list follows. */}
                  <Link
                    href={`/parent/results/print?child=${selected.studentProfileId}&term=${term.termId}`}
                    target="_blank"
                    rel="noopener"
                    className="text-sm font-medium text-brand-primary hover:underline"
                  >
                    Print this report card
                  </Link>
                </div>
              </Card>

              <ReportCardSummary card={card} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Heading() {
  return (
    <PageHeader
      title="Results"
      description="Report cards for each published term, exactly as your school issues them."
    />
  );
}
