import type { FeeCategory } from '@/db/schema/fee-types';

/**
 * The fee heads most Pakistani schools start with.
 *
 * Seeded on request rather than at provisioning: a school that bills
 * differently should not have to delete five rows before it can begin, and a
 * school that bills conventionally should not have to type them.
 *
 * Names are editable afterwards. What a school calls "Annual Charges" varies —
 * Development Fund, Miscellaneous, Annual Fund — but the shape is the same.
 */

export interface FeeTypeSeed {
  name: string;
  description: string;
  feeCategory: FeeCategory;
  sortOrder: number;
}

export const DEFAULT_FEE_TYPES: readonly FeeTypeSeed[] = [
  {
    name: 'Tuition Fee',
    description: 'Monthly tuition, charged on every challan.',
    feeCategory: 'monthly',
    sortOrder: 1,
  },
  {
    name: 'Admission Fee',
    description: 'Charged once, when a student joins the school.',
    feeCategory: 'one_time',
    sortOrder: 2,
  },
  {
    name: 'Annual Charges',
    description: 'Once per academic year, at the start of the session.',
    feeCategory: 'annual',
    sortOrder: 3,
  },
  {
    name: 'Library Fee',
    description: 'Once per academic year.',
    feeCategory: 'annual',
    sortOrder: 4,
  },
  {
    name: 'Examination Fee',
    description: 'Once per academic year, covering board and internal exams.',
    feeCategory: 'annual',
    sortOrder: 5,
  },
];
