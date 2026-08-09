/**
 * Naming a class so an operator can tell two of them apart.
 *
 * ## Why this module exists
 *
 * A school with two campuses running the same grade at both — which is the
 * ordinary case, not an exotic one — has two grades called "Grade 5" and two
 * sections called "Grade 5 — A". Every picker in this application built its own
 * label, and every one of them showed those two identically.
 *
 * That was found four separate times during Sprint 10 and its rehearsal: the
 * promotion picker, the aged-debt filter, the transfer picker and the
 * report-card picker. Each was fixed where it was found, which is how a defect
 * gets fixed four times and still exists in a fifth place. So the rule lives
 * here once.
 *
 * ## The rule
 *
 * **Qualify only what is actually ambiguous.** A single-campus school — most of
 * them — should not have to read its own name against every class it owns, and
 * a label that says "Main Campus" on every row teaches an operator to stop
 * reading the campus. The campus is added to a grade's name only when another
 * grade shares it.
 *
 * Dependency-free: the pickers that need this are a mix of server components
 * and client ones.
 */

export interface LabelledGrade {
  id: string;
  /** The grade's display name, e.g. `Grade 5`. */
  label: string;
  branchId: string;
}

export interface NamedBranch {
  id: string;
  name: string;
}

/**
 * Grade id → the name to show, qualified by campus only where it has to be.
 *
 * Returned as a map rather than a function so a caller can build it once and
 * use it inside a render loop without re-scanning the grade list per row.
 */
export function gradeLabels(
  grades: readonly LabelledGrade[],
  branches: readonly NamedBranch[],
): Map<string, string> {
  const timesSeen = new Map<string, number>();
  for (const grade of grades) {
    timesSeen.set(grade.label, (timesSeen.get(grade.label) ?? 0) + 1);
  }

  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const labels = new Map<string, string>();

  for (const grade of grades) {
    const ambiguous = (timesSeen.get(grade.label) ?? 0) > 1;
    const campus = branchName.get(grade.branchId);

    labels.set(
      grade.id,
      ambiguous && campus !== undefined ? `${grade.label} (${campus})` : grade.label,
    );
  }

  return labels;
}

/**
 * `Grade 5 (Johar Town) — A`, with an optional trailing count.
 *
 * The count is `(28)` rather than `(28 students)` because these labels sit in
 * `<option>` elements where the width is the operating constraint, and an
 * operator reading a class list knows what the number is.
 */
export function sectionLabel(
  gradeLabel: string,
  sectionName: string,
  studentCount?: number,
): string {
  const base = `${gradeLabel} — ${sectionName}`;
  return studentCount === undefined ? base : `${base} (${studentCount})`;
}
