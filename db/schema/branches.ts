import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { schools } from './schools';

/**
 * Academic tracks a Pakistani school branch can run.
 *
 *  MATRIC    Pakistani board, Pre-Nursery to Grade 10
 *  O_LEVELS  Cambridge, Pre-Nursery to O2
 *  A_LEVELS  Cambridge, Pre-Nursery to A2 (includes the O-Levels track)
 *  MIXED     More than one board taught at the same branch
 */
export const CURRICULUM_LEVELS = [
  'MATRIC',
  'O_LEVELS',
  'A_LEVELS',
  'MIXED',
] as const;
export type CurriculumLevel = (typeof CURRICULUM_LEVELS)[number];

export const CURRICULUM_LEVEL_LABELS: Record<CurriculumLevel, string> = {
  MATRIC: 'Matric (Pakistani Board)',
  O_LEVELS: 'O-Levels (Cambridge)',
  A_LEVELS: 'A-Levels (Cambridge)',
  MIXED: 'Mixed (multiple boards)',
};

export const CURRICULUM_LEVEL_DESCRIPTIONS: Record<CurriculumLevel, string> = {
  MATRIC: 'Pre-Nursery to Grade 10',
  O_LEVELS: 'Pre-Nursery to O2',
  A_LEVELS: 'Pre-Nursery to A2, includes the O-Levels track',
  MIXED: 'Multiple boards taught at this branch',
};

/**
 * branches — physical campuses belonging to one school.
 *
 * `code` is the school's own identifier for the campus (e.g. `KHI-MAIN`) and
 * is unique within the school, not globally. Exactly one branch per school
 * should carry `is_main_branch`; the API enforces that on write.
 */
export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** School-assigned campus code, e.g. 'KHI-MAIN'. Unique per school. */
    code: text('code').notNull(),
    city: text('city').notNull(),
    address: text('address'),
    /**
     * Where the address is, when it was picked on a map rather than typed.
     *
     * Null for every branch recorded before the picker existed and for any
     * whose operator typed the address by hand, which the form still allows —
     * see `components/ui/AddressAutocomplete.tsx`. So this is an enrichment, never a
     * precondition: nothing may require it to render a branch.
     */
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /**
     * Landline, in the display form `(021) 3456789`.
     *
     * Stored formatted rather than as bare digits because nothing selects a
     * branch by its landline — it is printed on a challan and dialled by a
     * parent, and the brackets are part of how it is read. `phone` below is the
     * one that has to normalise, because that one identifies people.
     */
    landline: text('landline'),
    /** Mobile, in the display form `(0321) 123-4567`. */
    phone: text('phone'),
    email: text('email'),
    curriculumLevel: text('curriculum_level').notNull().$type<CurriculumLevel>(),
    /**
     * The board this campus follows, when `curriculum_level` is `MIXED`.
     *
     * `MIXED` says only "more than one board", which is not enough to print on
     * a certificate or to answer "which board" in a report. The other three
     * levels name their own board, so this is null for them and required for
     * MIXED — enforced by the API rather than a CHECK constraint, because a
     * CHECK would refuse to apply at all if any existing MIXED branch has none,
     * and the migration cannot invent a board name for a school it has never
     * asked.
     */
    boardName: text('board_name'),
    /**
     * Which classes this campus actually teaches, as values from
     * `lib/branch-classes.ts`.
     *
     * Replaces `max_grade`, which was free text and could express only a
     * ceiling — see that module's docblock for why a ceiling was the wrong
     * shape. Empty is legitimate and means "not yet declared", which is what
     * every branch created before this column existed is.
     */
    classLevels: text('class_levels').array().notNull().default(sql`ARRAY[]::text[]`),
    /**
     * @deprecated Superseded by `class_levels`. Nothing writes it any more and
     * no screen reads it.
     *
     * Kept rather than dropped because the branches created before
     * `class_levels` existed have their operator's answer in here and nowhere
     * else, and a migration cannot convert it: `Grade 10`, `10`, `O2` and
     * `Matric` were all valid values of a free-text box, and guessing which
     * rung each meant would silently mis-declare a campus. Dropping the column
     * would delete the only record of what was typed; leaving it costs one
     * unused text column and lets the mapping be done by someone who can ask.
     */
    maxGrade: text('max_grade'),
    isActive: boolean('is_active').notNull().default(true),
    isMainBranch: boolean('is_main_branch').notNull().default(false),
    /** ID of the mirrored record in GHL's custom objects, if synced. */
    ghlCustomObjectId: text('ghl_custom_object_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('branches_location_id_idx').on(table.locationId),
    index('branches_location_id_is_active_idx').on(table.locationId, table.isActive),
    uniqueIndex('branches_location_id_code_idx').on(table.locationId, table.code),
    check(
      'branches_curriculum_level_check',
      sql`${table.curriculumLevel} IN ('MATRIC', 'O_LEVELS', 'A_LEVELS', 'MIXED')`,
    ),
  ],
);

export function isCurriculumLevel(value: unknown): value is CurriculumLevel {
  return (
    typeof value === 'string' &&
    (CURRICULUM_LEVELS as readonly string[]).includes(value)
  );
}

export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
