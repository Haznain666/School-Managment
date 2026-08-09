import { PrintDocument, PrintLetterhead } from '@/components/print/PrintSheet';
import type { Tabulation } from '@/lib/exam-queries';
import { formatMark, formatPercentage, ordinal } from '@/lib/grading';

/**
 * The tabulation sheet — every student down the side, every paper across the
 * top, and the totals a principal reads after an exam (`ROADMAP.md` §2b).
 *
 * Landscape, because a class of forty against eight papers does not fit
 * portrait and a sheet that wraps is a sheet nobody can follow across a row.
 *
 * Unpublished papers are on it, marked with a dagger. This sheet exists for
 * the review that happens *before* publication, and hiding the very numbers
 * being reviewed would make it useless at the one moment it is wanted. It is
 * behind `exams.read`, which no parent or student holds.
 *
 * A cell below the pass mark is bold rather than red: schools print in black
 * and white, and colour that survives on screen but not on paper is worse than
 * no signal at all.
 */

export interface TabulationDocumentProps {
  tabulation: Tabulation;
  schoolName: string;
  logoUrl: string | null;
  /** How many position holders to list under the grid. */
  topCount?: number;
}

export function TabulationDocument({
  tabulation,
  schoolName,
  logoUrl,
  topCount = 3,
}: TabulationDocumentProps) {
  const { exam, papers, rows } = tabulation;

  const holders = rows
    .filter((row) => row.position !== null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .filter((row) => (row.position ?? 0) <= topCount);

  return (
    <PrintDocument>
      <div className="p-1 text-[9px] leading-tight">
        <PrintLetterhead
          logoUrl={logoUrl}
          schoolName={schoolName}
          right={
            <>
              <p className="text-[11px] font-bold uppercase">Tabulation Sheet</p>
              <p>
                {exam.title} · {exam.termName}
              </p>
              <p>
                {exam.gradeName} — {exam.sectionName}
              </p>
            </>
          }
        />

        {tabulation.hasUnpublished ? (
          <p className="mt-1 text-[9px] italic">
            † Marks not yet published. This sheet is for review — nothing marked
            with a dagger has reached a parent.
          </p>
        ) : null}

        <table className="mt-2 w-full border-collapse border border-black">
          <thead>
            <tr>
              <th className="border border-black px-1 py-0.5 text-left">#</th>
              <th className="border border-black px-1 py-0.5 text-left">Student</th>
              <th className="border border-black px-1 py-0.5">Roll</th>
              {papers.map((paper) => (
                <th key={paper.id} className="border border-black px-1 py-0.5">
                  {paper.subjectCode ?? paper.subjectName}
                  {paper.resultsStatus === 'published' ? '' : ' †'}
                  <span className="block font-normal">/{formatMark(paper.maxMarks)}</span>
                </th>
              ))}
              <th className="border border-black px-1 py-0.5">Total</th>
              <th className="border border-black px-1 py-0.5">%</th>
              <th className="border border-black px-1 py-0.5">Grade</th>
              <th className="border border-black px-1 py-0.5">Pos.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.student.studentProfileId}>
                <td className="border border-black px-1 py-0.5">{index + 1}</td>
                <td className="border border-black px-1 py-0.5 text-left">
                  {row.student.studentName}
                </td>
                <td className="border border-black px-1 py-0.5 text-center">
                  {row.student.rollNumber ?? '—'}
                </td>

                {row.cells.map((cell) => (
                  <td
                    key={cell.examSubjectId}
                    className={`border border-black px-1 py-0.5 text-center ${cell.isFail ? 'font-bold' : ''}`}
                  >
                    {cell.isAbsent ? 'ABS' : formatMark(cell.marks)}
                    {cell.isResit ? '*' : ''}
                  </td>
                ))}

                <td className="border border-black px-1 py-0.5 text-center font-semibold">
                  {formatMark(row.obtained)}/{formatMark(row.available)}
                </td>
                <td className="border border-black px-1 py-0.5 text-center">
                  {formatPercentage(row.percentage)}
                </td>
                <td className="border border-black px-1 py-0.5 text-center">
                  {row.grade ?? '—'}
                </td>
                <td className="border border-black px-1 py-0.5 text-center">
                  {row.position === null ? '—' : ordinal(row.position)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* This sentence is what a principal reads to interpret the grid, so it
            has to state the policy the code actually implements: the paper's
            maximum stays in the denominator, the absent student contributes
            nothing to the numerator. It said the reverse until 2026-08-09. */}
        <p className="mt-1 text-[8px] italic">
          * re-sit mark · ABS absent: the paper still counts towards the marks
          available, and nothing is added to the marks obtained · a student
          absent from any paper takes no position.
        </p>

        <section className="mt-3 border border-black p-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wide">
            Position holders
          </p>
          {holders.length === 0 ? (
            <p className="mt-1">
              No positions yet — no student has a mark in every paper.
            </p>
          ) : (
            <ol className="mt-1 space-y-0.5">
              {holders.map((row) => (
                <li key={row.student.studentProfileId}>
                  <span className="font-semibold">
                    {ordinal(row.position ?? 0)}
                  </span>{' '}
                  {row.student.studentName} ({row.student.studentId}) —{' '}
                  {formatMark(row.obtained)}/{formatMark(row.available)},{' '}
                  {formatPercentage(row.percentage)}
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="mt-4 flex items-end justify-between text-[9px]">
          <span className="border-t border-black px-6 pt-0.5">Prepared by</span>
          <span className="border-t border-black px-6 pt-0.5">Checked by</span>
          <span className="border-t border-black px-6 pt-0.5">Principal</span>
        </div>
      </div>
    </PrintDocument>
  );
}
