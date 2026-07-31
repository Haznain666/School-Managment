import type { CurriculumLevel } from '@/db/schema/branches';

/**
 * The platform's grade ladders, one per curriculum (Sprint 4, Decision 1).
 *
 * A school may rename what a grade is *called* — that override lives in
 * `grades.display_name` — but it cannot invent grades or reorder them. Keeping
 * the sequence fixed is what makes promotion ("move everyone up one") and
 * cross-school reporting possible at all; a free-text class name, which is what
 * Sprint 1's `students.class_name` was, supports neither.
 *
 * `sortOrder` is 1-based and contiguous within each list, and the same name
 * carries the same position in every list it appears in — so a branch that
 * switches from O-Levels to A-Levels keeps its existing rows and simply gains
 * the two at the top.
 */

// Re-exported rather than redeclared: `branches.curriculum_level` is the one
// definition of what a curriculum can be, and a second copy here would be free
// to drift out of step with the CHECK constraint.
export type { CurriculumLevel };

export interface GradeDefinition {
  /** Canonical name stored in `grades.name`. */
  name: string;
  /** 1-based position in the ladder, stored in `grades.sort_order`. */
  sortOrder: number;
}

/** Turns an ordered name list into definitions numbered from 1. */
function ladder(names: readonly string[]): readonly GradeDefinition[] {
  return names.map((name, index) => ({ name, sortOrder: index + 1 }));
}

/** Pre-Nursery to Prep — shared by every curriculum. */
const EARLY_YEARS: readonly string[] = ['Pre-Nursery', 'Nursery', 'Prep'];

/** Pakistani board: Class 1 to Class 10. */
const MATRIC_GRADES: readonly string[] = [
  ...EARLY_YEARS,
  'Class 1',
  'Class 2',
  'Class 3',
  'Class 4',
  'Class 5',
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
];

/** Cambridge lower school: Year 1 to Year 9, then the two O-Level years. */
const O_LEVEL_GRADES: readonly string[] = [
  ...EARLY_YEARS,
  'Year 1',
  'Year 2',
  'Year 3',
  'Year 4',
  'Year 5',
  'Year 6',
  'Year 7',
  'Year 8',
  'Year 9',
  'O Level 1',
  'O Level 2',
];

/** The O-Levels ladder continued through sixth form. */
const A_LEVEL_GRADES: readonly string[] = [
  ...O_LEVEL_GRADES,
  'AS Level',
  'A2 Level',
];

export const PREDEFINED_GRADES: Readonly<
  Record<CurriculumLevel, readonly GradeDefinition[]>
> = {
  MATRIC: ladder(MATRIC_GRADES),
  O_LEVELS: ladder(O_LEVEL_GRADES),
  A_LEVELS: ladder(A_LEVEL_GRADES),
  // A branch teaching more than one board needs every rung either board uses.
  // The A-Levels ladder is that superset, so MIXED reuses it rather than
  // maintaining a second copy that could drift out of step.
  MIXED: ladder(A_LEVEL_GRADES),
};

/** The grade ladder a branch on this curriculum should be seeded with. */
export function getGradesForCurriculum(
  curriculum: CurriculumLevel,
): GradeDefinition[] {
  return [...PREDEFINED_GRADES[curriculum]];
}

/** Looks up one rung by position, or null when the curriculum has no such rung. */
export function gradeAtSortOrder(
  curriculum: CurriculumLevel,
  sortOrder: number,
): GradeDefinition | null {
  return (
    PREDEFINED_GRADES[curriculum].find(
      (grade) => grade.sortOrder === sortOrder,
    ) ?? null
  );
}
