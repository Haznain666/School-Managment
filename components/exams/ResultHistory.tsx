import { SubcategoryBadge } from '@/components/exams/SubcategoryBadge';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { PROMOTION_STATUS_LABELS } from '@/db/schema/student-term-results';
import type { StudentTermHistoryRow } from '@/lib/exam-queries';
import { formatPercentage } from '@/lib/grading';

/**
 * Every term a child has a judgement for, newest first.
 *
 * ── One component, both portals ──────────────────────────────────────────
 * A parent and a student are looking at the same record, and a second
 * rendering of it is how the two come to disagree about a year the child was
 * held back in. `listStudentResultHistory` is likewise the single query.
 *
 * ── Each row renders by its own frozen mechanism ─────────────────────────
 * `student_term_results.mechanism` is copied at compute time and never re-read
 * from the criteria, so a child who moved from a descriptor class to a marked
 * one shows descriptors for the early years and percentages for the later ones
 * — which is what actually happened to them. A history that re-resolved the
 * mechanism would render every old year blank.
 */

export interface ResultHistoryProps {
  history: readonly StudentTermHistoryRow[];
  colorCodingEnabled: boolean;
  /** Named so the empty state can say whose record is empty. */
  studentName: string;
}

export function ResultHistory({
  history,
  colorCodingEnabled,
  studentName,
}: ResultHistoryProps) {
  return (
    <Card
      header={
        <CardTitle
          title="Result history"
          description="Every published term, newest first."
        />
      }
      className="p-0"
    >
      {history.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">
          No term has been finalised for {studentName} yet. A term appears here
          once the school has published it and settled its promotion.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="px-5 py-2 font-medium text-ink-muted">
                  Term
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-muted">
                  Class
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-ink-muted">
                  Overall
                </th>
                <th scope="col" className="px-5 py-2 font-medium text-ink-muted">
                  Promotion
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {history.map((row) => (
                <tr key={row.termId}>
                  <th scope="row" className="px-5 py-2.5 text-left font-normal text-ink">
                    {row.termName}
                    <span className="block text-xs text-ink-muted">
                      {row.academicYearName}
                    </span>
                  </th>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {row.gradeName} {row.sectionName}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.mechanism === 'descriptors' ? (
                      <SubcategoryBadge
                        subcategory={row.overallSubcategory}
                        colorCoded={colorCodingEnabled}
                      />
                    ) : (
                      <span className="text-ink">
                        {row.overallPercentage === null
                          ? '—'
                          : formatPercentage(row.overallPercentage)}
                        {row.overallGradeLabel === null
                          ? ''
                          : ` · ${row.overallGradeLabel}`}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2.5">
                    <Badge
                      variant={row.finalStatus === 'promoted' ? 'success' : 'danger'}
                    >
                      {PROMOTION_STATUS_LABELS[row.finalStatus]}
                    </Badge>
                    {row.isOverridden && row.overrideReason !== null ? (
                      <span className="mt-1 block text-xs text-ink-muted">
                        {row.overrideReason}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
