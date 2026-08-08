import { PrintDocument, PrintLetterhead } from '@/components/print/PrintSheet';
import type { AdmitCard } from '@/lib/exam-queries';

/**
 * The admit card a student brings to the hall.
 *
 * Two to a sheet rather than one, because a school prints one per student and
 * a class of forty should not be forty sheets. The pair is laid out by the
 * caller; this is one card.
 *
 * It carries the datesheet in full — every paper, its date and its sitting —
 * because the card is the only piece of paper a student is guaranteed to have
 * with them, and a card that says only "you may sit the exam" sends them to
 * ask the office when Physics is.
 *
 * Issued only for an announced exam. That gate is on the page, not here: this
 * component renders what it is given.
 */

export interface AdmitCardDocumentProps {
  card: AdmitCard;
  schoolName: string;
  schoolAddress?: string | null;
  logoUrl: string | null;
  breakAfter?: boolean;
}

export function AdmitCardDocument({
  card,
  schoolName,
  schoolAddress,
  logoUrl,
  breakAfter = false,
}: AdmitCardDocumentProps) {
  const { student, exam, papers } = card;

  return (
    <PrintDocument breakAfter={breakAfter}>
      <div className="border border-black p-2 text-[10px] leading-tight">
        <PrintLetterhead
          logoUrl={logoUrl}
          schoolName={schoolName}
          address={schoolAddress}
          right={
            <>
              <p className="text-[11px] font-bold uppercase">Admit Card</p>
              <p>{exam.title}</p>
              <p>{exam.termName}</p>
            </>
          }
        />

        <section className="mt-2 grid grid-cols-4 gap-x-3 gap-y-0.5">
          <Field label="Student" value={student.studentName} />
          <Field label="Admission no." value={student.studentId} />
          <Field label="Class" value={`${exam.gradeName} — ${exam.sectionName}`} />
          <Field
            label="Roll no."
            value={
              student.rollNumber === null || student.rollNumber === ''
                ? '—'
                : student.rollNumber
            }
          />
        </section>

        <table className="mt-2 w-full border-collapse border border-black">
          <thead>
            <tr>
              <th className="border border-black px-1 py-0.5 text-left text-[9px] uppercase">
                Date
              </th>
              <th className="border border-black px-1 py-0.5 text-left text-[9px] uppercase">
                Sitting
              </th>
              <th className="border border-black px-1 py-0.5 text-left text-[9px] uppercase">
                Subject
              </th>
              <th className="border border-black px-1 py-0.5 text-[9px] uppercase">
                Max
              </th>
            </tr>
          </thead>
          <tbody>
            {papers.map((paper) => (
              <tr key={paper.id}>
                <td className="border border-black px-1 py-0.5">
                  {paper.examDate ?? exam.examDate}
                </td>
                <td className="border border-black px-1 py-0.5">{paper.slot ?? '—'}</td>
                <td className="border border-black px-1 py-0.5">{paper.subjectName}</td>
                <td className="border border-black px-1 py-0.5 text-center">
                  {paper.maxMarks}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {exam.instructions === null || exam.instructions === '' ? null : (
          <p className="mt-1.5 text-[9px]">
            <span className="font-bold uppercase">Instructions: </span>
            {exam.instructions}
          </p>
        )}

        <div className="mt-4 flex items-end justify-between text-[9px]">
          <span className="border-t border-black px-6 pt-0.5">Student</span>
          <span className="border-t border-black px-6 pt-0.5">
            Controller of Examinations
          </span>
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
