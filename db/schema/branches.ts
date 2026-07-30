import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
    phone: text('phone'),
    email: text('email'),
    curriculumLevel: text('curriculum_level').notNull().$type<CurriculumLevel>(),
    /** Highest grade this campus teaches, e.g. 'Grade 10', 'A2'. */
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
