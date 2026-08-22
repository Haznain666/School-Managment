import { SubcategoryBadge } from '@/components/exams/SubcategoryBadge';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { PROMOTION_STATUS_LABELS } from '@/db/schema/student-term-results';
import type { ReportCard } from '@/lib/exam-queries';
import { formatMark, formatPercentage } from '@/lib/grading';

/**
 * A report card laid out for a screen — usually a phone.
 *
 * ── Why this is not `ReportCardDocument` ─────────────────────────────────
 * That component is the A4 sheet, and it is right: 10px type, hairline rules,
 * everything on one page. On a phone it is unreadable, and shrinking a parent's
 * screen to fit a sheet of paper is the wrong way round.
 *
 * ── And why that is not drift ────────────────────────────────────────────
 * Both take the same `ReportCard`, computed once by `getSectionReportCards()`.
 * Sprint 12 established the shape and the reason: one definition, several
 * renderers, so a column cannot exist on one and not another. What is refused
 * here is a *second computation* — no total is re-added, no percentage
 * recalculated, no grade re-resolved. Every number on this screen is the number
 * that prints.
 *
 * The three refusals `ReportCardDocument` documents are inherited rather than
 * restated, because they live in the data: a null grade prints a dash, an
 * absent child has no position, and an unpublished term never reaches a parent
 * at all (`lib/portal-results.ts`).
 *
 * Sprint 14 adds the same two-sheet split the printed card carries: a class
 * judged on descriptors shows Subject / Sub-category / Comment and no marks
 * anywhere, and a marks class shows no sub-category column. The promotion
 * status and, where there is one, the reason the school changed it sit at the
 * top — the reason is shown to the family deliberately.
 */
export function ReportCardSummary({ card }: { card: ReportCard }) {
  const isDescriptorMode = card.mechanism === 'descriptors';

  return (
    <div className="space-y-4">
      <Card>
        {isDescriptorMode ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Overall
              </p>
              <p className="mt-1">
                <SubcategoryBadge
                  subcategory={card.overallSubcategory}
                  colorCoded={card.colorCodingEnabled}
                />
              </p>
            </div>
            <Figure
              label="Subjects needing attention"
              value={String(card.failedCount)}
            />
            <Figure label="Papers missed" value={String(card.absentCount)} />
          </div>
        ) : (
          // The mean of the subject percentages, matching the printed card and
          // the Result history table below — and matching what the promotion
          // decision was actually taken on. Printing the ratio here put two
          // different percentages for one term on one screen.
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Percentage" value={formatPercentage(card.meanPercentage)} />
            <Figure
              label="Total"
              value={`${formatMark(card.obtained)} / ${formatMark(card.available)}`}
            />
            <Figure label="Grade" value={card.overallGradeLabel ?? '—'} />
            <Figure
              label="Position"
              value={
                card.position === null ? '—' : `${card.position} of ${card.classSize}`
              }
            />
          </div>
        )}

        {card.promotion === null ? null : (
          <div className="mt-4 rounded-lg bg-surface-sunken px-3 py-2">
            <p className="text-sm text-ink">
              <span className="font-medium">Promotion: </span>
              {PROMOTION_STATUS_LABELS[card.promotion.finalStatus]}
            </p>
            {/* The reason a status was changed is shown to the family
                deliberately — the product owner asked for it, and a status a
                parent cannot ask about is a status they distrust. */}
            {card.promotion.isOverridden && card.promotion.overrideReason !== null ? (
              <p className="mt-1 text-sm text-ink-muted">
                Changed by the school from{' '}
                {PROMOTION_STATUS_LABELS[card.promotion.computedStatus].toLowerCase()}:{' '}
                {card.promotion.overrideReason}
              </p>
            ) : null}
          </div>
        )}

        {!isDescriptorMode && card.position === null && card.absentCount > 0 ? (
          <p className="mt-4 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
            No position is given because {card.absentCount} paper
            {card.absentCount === 1 ? ' was' : 's were'} missed. Ranking a child
            against classmates who sat everything would not be a fair comparison.
          </p>
        ) : null}

        {card.remark === null || card.remark === '' ? null : (
          <p className="mt-4 text-sm text-ink">
            <span className="font-medium">Remark: </span>
            {card.remark}
          </p>
        )}
      </Card>

      <Card
        header={
          <CardTitle
            title="Subjects"
            description={`${card.termName} · ${card.gradeName} ${card.sectionName} · ${card.academicYearName}`}
          />
        }
        className="p-0"
      >
        {/* A real table, and it scrolls inside its own box rather than pushing
            the page sideways on a narrow screen. */}
        <div className="overflow-x-auto">
          {isDescriptorMode ? (
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="px-5 py-2 font-medium text-ink-muted">
                    Subject
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-ink-muted">
                    Sub-category
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium text-ink-muted">
                    Comment
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {card.subjects.map((subject, index) => (
                  <tr key={`${subject.subjectName}-${index}`}>
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-normal text-ink"
                    >
                      {subject.subjectName}
                    </th>
                    <td className="px-3 py-2.5">
                      {subject.isAbsent ? (
                        <span className="text-ink-muted">ABS</span>
                      ) : (
                        <SubcategoryBadge
                          subcategory={subject.subcategory}
                          colorCoded={card.colorCodingEnabled}
                        />
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-ink-muted">
                      {subject.comment ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="px-5 py-2 font-medium text-ink-muted">
                    Subject
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-medium text-ink-muted"
                  >
                    Marks
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-medium text-ink-muted"
                  >
                    Out of
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-medium text-ink-muted"
                  >
                    %
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-medium text-ink-muted"
                  >
                    Grade
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium text-ink-muted">
                    Comment
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {card.subjects.map((subject, index) => (
                  <tr key={`${subject.subjectName}-${index}`}>
                    <th
                      scope="row"
                      className="px-5 py-2.5 text-left font-normal text-ink"
                    >
                      {subject.subjectName}
                      {subject.isResit ? (
                        <Badge variant="neutral" className="ml-2">
                          Re-sit
                        </Badge>
                      ) : null}
                    </th>
                    <td
                      className={
                        subject.isFail
                          ? 'px-3 py-2.5 text-right font-medium text-status-danger-ink'
                          : 'px-3 py-2.5 text-right text-ink'
                      }
                    >
                      {subject.isAbsent ? 'ABS' : formatMark(subject.marks)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink-muted">
                      {formatMark(subject.maxMarks)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink-muted">
                      {subject.percentage === null
                        ? '—'
                        : formatPercentage(subject.percentage)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink">
                      {subject.grade ?? '—'}
                    </td>
                    <td className="px-5 py-2.5 text-ink-muted">
                      {subject.comment ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card header={<CardTitle title="Attendance for this term" />}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Figure label="Present" value={String(card.attendance.present)} />
          <Figure label="Absent" value={String(card.attendance.absent)} />
          <Figure label="Late" value={String(card.attendance.late)} />
          <Figure label="Excused" value={String(card.attendance.excused)} />
          <Figure
            label="Attendance"
            value={formatPercentage(card.attendance.percentage)}
          />
        </div>
      </Card>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
