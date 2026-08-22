import { SubcategoryBadge } from '@/components/exams/SubcategoryBadge';
import { PrintDocument, PrintLetterhead } from '@/components/print/PrintSheet';
import { PROMOTION_STATUS_LABELS } from '@/db/schema/student-term-results';
import { formatMark, formatPercentage, ordinal } from '@/lib/grading';
import type { ReportCard } from '@/lib/exam-queries';

/**
 * The report card — the artefact a parent judges the whole system by
 * (`ROADMAP.md` §2 Tier 1 #2).
 *
 * ── What is on it, and why each thing is ─────────────────────────────────
 * Subject marks, the total, the percentage, the grade, position in class, the
 * attendance summary and the school's remark. Nothing else: a report card that
 * tries to be a dashboard stops being readable at the kitchen table, which is
 * where this one is read.
 *
 * ── The three things it refuses to fake ──────────────────────────────────
 *   1. No grade when the school has configured no bands. A dash, not an
 *      invented "F". Nothing here is entitled to decide what an A is.
 *   2. No position for a child who missed a paper, with the absence printed
 *      instead. Ranking them against children who sat everything would be a
 *      quiet lie in the one number families compare.
 *   3. "PREVIEW" across the top until the term is published, so a card printed
 *      during checking cannot be mistaken for the real thing.
 *
 * ── Two sheets, decided per class ────────────────────────────────────────
 * Sprint 14: a class judged on performance descriptors has no marks, no
 * percentages and no letter grades *anywhere* on this sheet, and a marks class
 * has no sub-category column at all. They are alternatives rather than a
 * variation, so the table is written twice rather than made conditional column
 * by column — a half-blank marks table is what a parent reads as a lost record.
 * The mechanism is frozen on `student_term_results`, so a card issued under
 * descriptors keeps printing as one after the school switches the class.
 *
 * ── The promotion status and the reason it was changed both print ────────
 * The product owner asked for the reason a status was overridden to be visible
 * to every relevant party *including parents*, and the report card is the
 * document a parent actually keeps. Where no term result has been computed the
 * block is absent rather than guessing — nothing here says "not promoted"
 * because nobody has pressed a button yet.
 *
 * Layout only. Page size, break behaviour and hiding the portal shell belong
 * to `<PrintSheet>`.
 */

export interface ReportCardDocumentProps {
  card: ReportCard;
  schoolName: string;
  schoolAddress?: string | null;
  schoolPhone?: string | null;
  logoUrl: string | null;
  breakAfter?: boolean;
}

export function ReportCardDocument({
  card,
  schoolName,
  schoolAddress,
  schoolPhone,
  logoUrl,
  breakAfter = false,
}: ReportCardDocumentProps) {
  return (
    <PrintDocument breakAfter={breakAfter}>
      <div className="p-1 text-[10px] leading-tight">
        <PrintLetterhead
          logoUrl={logoUrl}
          schoolName={schoolName}
          address={schoolAddress}
          phone={schoolPhone}
          right={
            <>
              <p className="text-[11px] font-bold uppercase">Report Card</p>
              <p>{card.termName}</p>
              <p>{card.academicYearName}</p>
            </>
          }
        />

        {card.termIsPublished ? null : (
          <p className="mt-1 border border-black px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-widest">
            Preview — this term has not been published
          </p>
        )}

        <section className="mt-2 grid grid-cols-4 gap-x-3 gap-y-0.5 border border-black p-1.5">
          <Field label="Student" value={card.student.studentName} />
          <Field label="Admission no." value={card.student.studentId} />
          <Field label="Class" value={`${card.gradeName} — ${card.sectionName}`} />
          <Field
            label="Roll no."
            value={
              card.student.rollNumber === null || card.student.rollNumber === ''
                ? '—'
                : card.student.rollNumber
            }
          />
        </section>

        {card.mechanism === 'descriptors' ? (
          <table className="mt-2 w-full border-collapse border border-black">
            <thead>
              <tr>
                <Th className="text-left">Subject</Th>
                <Th>Sub-category</Th>
                <Th className="text-left">Comment</Th>
              </tr>
            </thead>
            <tbody>
              {card.subjects.length === 0 ? (
                <tr>
                  <Td colSpan={3} className="text-center">
                    No results have been published for this term yet.
                  </Td>
                </tr>
              ) : (
                card.subjects.map((subject, index) => (
                  <tr key={`${subject.subjectName}-${index}`}>
                    <Td className="text-left">{subject.subjectName}</Td>
                    <Td>
                      {subject.isAbsent ? (
                        'ABS'
                      ) : (
                        <SubcategoryBadge
                          subcategory={subject.subcategory}
                          colorCoded={card.colorCodingEnabled}
                        />
                      )}
                    </Td>
                    <Td className="text-left">{subject.comment ?? '—'}</Td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <Td className="text-left">Overall</Td>
                <Td>
                  <SubcategoryBadge
                    subcategory={card.overallSubcategory}
                    colorCoded={card.colorCodingEnabled}
                  />
                </Td>
                <Td className="text-left">—</Td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="mt-2 w-full border-collapse border border-black">
            <thead>
              <tr>
                <Th className="text-left">Subject</Th>
                <Th>Max</Th>
                <Th>Pass</Th>
                <Th>Obtained</Th>
                <Th>%</Th>
                <Th>Grade</Th>
                <Th className="text-left">Comment</Th>
              </tr>
            </thead>
            <tbody>
              {card.subjects.length === 0 ? (
                <tr>
                  <Td colSpan={7} className="text-center">
                    No results have been published for this term yet.
                  </Td>
                </tr>
              ) : (
                card.subjects.map((subject, index) => (
                  <tr key={`${subject.subjectName}-${index}`}>
                    <Td className="text-left">
                      {subject.subjectName}
                      {subject.isResit ? ' (re-sit)' : ''}
                    </Td>
                    <Td>{formatMark(subject.maxMarks)}</Td>
                    <Td>{formatMark(subject.passingMarks)}</Td>
                    <Td className={subject.isFail ? 'font-bold' : undefined}>
                      {subject.isAbsent ? 'ABS' : formatMark(subject.marks)}
                    </Td>
                    <Td>
                      {subject.isAbsent ? '—' : formatPercentage(subject.percentage)}
                    </Td>
                    <Td>{subject.grade ?? '—'}</Td>
                    <Td className="text-left">{subject.comment ?? '—'}</Td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <Td className="text-left">Total</Td>
                <Td>{formatMark(card.available)}</Td>
                <Td>—</Td>
                <Td>{formatMark(card.obtained)}</Td>
                <Td>{formatPercentage(card.percentage)}</Td>
                <Td>{card.grade ?? '—'}</Td>
                <Td className="text-left">—</Td>
              </tr>
            </tfoot>
          </table>
        )}

        <section className="mt-2 grid grid-cols-2 gap-2">
          <div className="border border-black p-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wide">Result</p>
            {card.mechanism === 'descriptors' ? (
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                <Field
                  label="Subjects needing attention"
                  value={String(card.failedCount)}
                />
                <Field label="Papers missed" value={String(card.absentCount)} />
              </div>
            ) : (
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                <Field
                  label="Position in class"
                  value={
                    card.position === null
                      ? card.absentCount > 0
                        ? `Not ranked (absent from ${card.absentCount} paper${card.absentCount === 1 ? '' : 's'})`
                        : 'Not ranked'
                      : `${ordinal(card.position)} of ${card.classSize}`
                  }
                />
                <Field label="Grade" value={card.grade ?? '—'} />
                <Field
                  label="GPA"
                  value={card.gpa === null ? '—' : card.gpa.toFixed(2)}
                />
                <Field
                  label="Papers below pass"
                  value={String(card.failedCount)}
                />
              </div>
            )}

            {card.promotion === null ? null : (
              <div className="mt-1 border-t border-dotted border-black pt-1">
                <Field
                  label="Promotion"
                  value={PROMOTION_STATUS_LABELS[card.promotion.finalStatus]}
                />
                {card.promotion.isOverridden && card.promotion.overrideReason !== null ? (
                  <p className="mt-0.5 text-[9px] italic">
                    Changed from{' '}
                    {PROMOTION_STATUS_LABELS[
                      card.promotion.computedStatus
                    ].toLowerCase()}
                    : {card.promotion.overrideReason}
                  </p>
                ) : null}
              </div>
            )}

            {card.remark === null ? null : (
              <p className="mt-1 text-[10px] italic">{card.remark}</p>
            )}
          </div>

          <div className="border border-black p-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wide">
              Attendance ({card.startDate} to {card.endDate})
            </p>
            <div className="mt-1 grid grid-cols-3 gap-x-3 gap-y-0.5">
              <Field label="Present" value={String(card.attendance.present)} />
              <Field label="Absent" value={String(card.attendance.absent)} />
              <Field label="Late" value={String(card.attendance.late)} />
              <Field label="Excused" value={String(card.attendance.excused)} />
              <Field label="Holidays" value={String(card.attendance.holiday)} />
              <Field
                label="Attendance"
                value={formatPercentage(card.attendance.percentage)}
              />
            </div>
          </div>
        </section>

        <section className="mt-2 border border-black p-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wide">
            Class teacher’s remarks
          </p>
          {/* Deliberately blank ruled space: the remark that matters is
              handwritten and signed, and a school that wants it typed can add
              the field when it asks for it. */}
          <div className="mt-2 h-6 border-b border-dotted border-black" />
        </section>

        <div className="mt-3 flex items-end justify-between text-[9px]">
          <span className="border-t border-black px-6 pt-0.5">Class teacher</span>
          <span className="border-t border-black px-6 pt-0.5">Principal</span>
          <span className="border-t border-black px-6 pt-0.5">Parent / Guardian</span>
        </div>
      </div>
    </PrintDocument>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-[9px] uppercase tracking-wide">{label}: </span>
      <span className="font-semibold">{value}</span>
    </p>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`border border-black px-1 py-0.5 text-center text-[9px] font-bold uppercase ${className ?? ''}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`border border-black px-1 py-0.5 text-center ${className ?? ''}`}
    >
      {children}
    </td>
  );
}
