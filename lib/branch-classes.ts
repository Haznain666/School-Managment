import type { CurriculumLevel } from '@/db/schema/branches';

/**
 * The classes a branch declares it runs.
 *
 * ── Why this is not `lib/predefined-grades.ts` ───────────────────────────
 * That module is the *ladder*: the full, ordered, non-negotiable sequence a
 * curriculum can contain, which promotion walks one rung at a time and which
 * cross-school reporting compares against. Every branch on a curriculum gets
 * the same ladder, and that is the point of it.
 *
 * This module is the *declaration*: which rungs of that ladder this particular
 * campus actually teaches. A junior campus running Pre-School to Grade 5 and a
 * senior campus running Grade 6 to A2 are both on the same ladder and teach
 * disjoint parts of it. Before this existed the branch form asked for a single
 * "Highest grade" free-text box, which could express neither the junior campus
 * (it has a floor as well as a ceiling) nor a campus that skips a year, and
 * which was free text so `Grade 10`, `10`, `Class X` and `Matric` all meant the
 * same thing and none of them were comparable.
 *
 * The two stay separate because they answer different questions and change for
 * different reasons. The ladder is a platform decision; the declaration is a
 * school's own fact about one of its campuses.
 *
 * ── The lists ────────────────────────────────────────────────────────────
 * Every curriculum shares the early years through Grade 8, then diverges:
 *
 *   MATRIC     … Grade 9, Grade 10
 *   O_LEVELS   … O1, O2, O3
 *   A_LEVELS   … O1, O2, O3, AS, A2
 *   MIXED      … Grade 9, Grade 10  (a mixed campus names its own board, and
 *                the local board's two senior years are what it has in common
 *                with every other reading of "mixed")
 */

export interface ClassOption {
  /** Stored value. Stable — it is what lands in `branches.class_levels`. */
  value: string;
  /** What the operator reads. */
  label: string;
}

/** Pre-School through Grade 8, shared by every curriculum. */
const COMMON_CLASSES: readonly ClassOption[] = [
  { value: 'PRE_SCHOOL', label: 'Pre-School' },
  { value: 'NURSERY', label: 'Nursery' },
  { value: 'PREP', label: 'Prep' },
  { value: 'GRADE_1', label: 'Grade 1' },
  { value: 'GRADE_2', label: 'Grade 2' },
  { value: 'GRADE_3', label: 'Grade 3' },
  { value: 'GRADE_4', label: 'Grade 4' },
  { value: 'GRADE_5', label: 'Grade 5' },
  { value: 'GRADE_6', label: 'Grade 6' },
  { value: 'GRADE_7', label: 'Grade 7' },
  { value: 'GRADE_8', label: 'Grade 8' },
];

/** The two senior years of the Pakistani board. */
const MATRIC_CLASSES: readonly ClassOption[] = [
  { value: 'GRADE_9', label: 'Grade 9' },
  { value: 'GRADE_10', label: 'Grade 10' },
];

/** Cambridge O Levels. */
const O_LEVEL_CLASSES: readonly ClassOption[] = [
  { value: 'O1', label: 'O1' },
  { value: 'O2', label: 'O2' },
  { value: 'O3', label: 'O3' },
];

/** O Levels continued through sixth form. */
const A_LEVEL_CLASSES: readonly ClassOption[] = [
  ...O_LEVEL_CLASSES,
  { value: 'AS', label: 'AS' },
  { value: 'A2', label: 'A2' },
];

const SENIOR_CLASSES: Readonly<Record<CurriculumLevel, readonly ClassOption[]>> = {
  MATRIC: MATRIC_CLASSES,
  O_LEVELS: O_LEVEL_CLASSES,
  A_LEVELS: A_LEVEL_CLASSES,
  MIXED: MATRIC_CLASSES,
};

/**
 * Every class a branch on this curriculum may declare, in ladder order.
 *
 * Order is load-bearing: the multi-select renders in this sequence, and a
 * campus's classes read as a range only if the options are ordered as one.
 */
export function classOptionsFor(curriculum: CurriculumLevel): ClassOption[] {
  return [...COMMON_CLASSES, ...SENIOR_CLASSES[curriculum]];
}

/** Every value any curriculum permits — the set a stored value must belong to. */
const ALL_VALUES: ReadonlySet<string> = new Set(
  [...COMMON_CLASSES, ...MATRIC_CLASSES, ...A_LEVEL_CLASSES].map((option) => option.value),
);

const LABELS: ReadonlyMap<string, string> = new Map(
  [...COMMON_CLASSES, ...MATRIC_CLASSES, ...A_LEVEL_CLASSES].map((option) => [
    option.value,
    option.label,
  ]),
);

/** `GRADE_9` → `Grade 9`. Falls back to the raw value for anything unrecognised. */
export function classLabel(value: string): string {
  return LABELS.get(value) ?? value;
}

/**
 * Filters a submitted list down to the values this curriculum actually offers,
 * in ladder order and without duplicates.
 *
 * Written as a filter rather than a validator on purpose. The commonest way to
 * arrive here with an out-of-range value is not an attack — it is an operator
 * who ticked O1/O2/O3 and then changed the curriculum to Matric, where those
 * rungs do not exist. Refusing the whole submission would make them re-tick
 * eleven boxes to fix one; dropping what no longer applies is what they meant.
 *
 * Ordering by the option list rather than preserving submission order is what
 * makes two branches with the same classes compare equal.
 */
export function sanitiseClassLevels(
  value: unknown,
  curriculum: CurriculumLevel,
): string[] {
  if (!Array.isArray(value)) return [];

  const permitted = new Set(classOptionsFor(curriculum).map((option) => option.value));
  const chosen = new Set(
    value.filter(
      (entry): entry is string => typeof entry === 'string' && permitted.has(entry),
    ),
  );

  return classOptionsFor(curriculum)
    .map((option) => option.value)
    .filter((entry) => chosen.has(entry));
}

/** True when every entry is a class value this platform knows. */
export function areClassLevels(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && ALL_VALUES.has(entry))
  );
}

/**
 * `Pre-School – Grade 5`, or the full list when it has gaps.
 *
 * A campus's classes are almost always a contiguous run, and "Pre-School –
 * Grade 5" is what its staff call it. Spelling out eleven labels in a table
 * cell would be accurate and unreadable. When the run *is* broken — a campus
 * that skips a year, which is why the range is checked rather than assumed —
 * the list is the only honest summary, so that is what is shown.
 */
export function classRangeLabel(values: readonly string[], curriculum: CurriculumLevel): string {
  if (values.length === 0) return '';

  const ladder = classOptionsFor(curriculum).map((option) => option.value);
  const positions = values
    .map((value) => ladder.indexOf(value))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);

  if (positions.length === 0) return values.map(classLabel).join(', ');
  if (positions.length === 1) return classLabel(ladder[positions[0]!]!);

  const first = positions[0]!;
  const last = positions[positions.length - 1]!;
  const contiguous = last - first + 1 === positions.length;

  return contiguous
    ? `${classLabel(ladder[first]!)} – ${classLabel(ladder[last]!)}`
    : positions.map((index) => classLabel(ladder[index]!)).join(', ');
}
