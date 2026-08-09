/**
 * The adversarial test school — `SPRINTS.md` §0.8.
 *
 * ## Why this is deliberately messy
 *
 * Release 1's gate is a **full-term dress rehearsal on seeded data**, because
 * the pilot is a test school rather than a real one. That choice only buys
 * anything if the seed is hostile:
 *
 * > *a tidy seed would hide exactly the defects the rehearsal exists to find.*
 *
 * So this script seeds the things that break software, on purpose:
 *
 * | What | Why it is here |
 * | --- | --- |
 * | Siblings sharing one guardian phone | The family voucher's grouping key. Without them the feature is untested. |
 * | Guardians with **no email** | Sprint 4's `canReachGuardian` and the unreachable count. Common in this market. |
 * | Guardians with no phone **and** no email | The aged-debt report's "nobody to chase" column. |
 * | Mid-term joiners | Enrolment dates that are not the 1st of the year, which proration and attendance percentages both trip over. |
 * | Partial payments | `paid_amount` between zero and the total — the state most fee code forgets. |
 * | Concessions | A challan whose total is not the sum of the price list. |
 * | Two branches | Every tenancy and branch-scope check. One campus proves nothing. |
 * | Three academic years | Promotion needs a year to move *out of* and one to move *into*, plus a past one so history is not empty. Two is not enough — see `seedYears`. |
 * | Names with commas, apostrophes and non-ASCII | CSV export, print letterheads, and `PrintSheet`. |
 * | A student with no guardian at all | The join that silently drops rows. |
 *
 * ## Idempotency
 *
 * Re-running replaces the seeded school entirely: everything is created under
 * a fixed slug and the script deletes that school first. `schools.location_id`
 * cascades to all 43 tenant tables, so there is nothing to clean up by hand
 * and no half-seeded state to reason about.
 *
 * **It refuses to touch a school it did not create.** The slug is fixed and
 * the school carries a marker in its address; if a school exists on that slug
 * without the marker, the script stops rather than deleting somebody's data.
 *
 * ## Running it
 *
 * ```bash
 * DATABASE_URL="…:5432/postgres" npx tsx db/seed/adversarial-school.ts
 * ```
 *
 * Use the **session** pooler (5432), not the transaction pooler (6543): this
 * writes thousands of rows in a handful of transactions and 6543 will not hold
 * them. That is the same split `db:migrate` needs — see STATE.md §5d.
 */

import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import {
  academicYears,
  branches,
  feeChallanItems,
  feeChallans,
  feePayments,
  feeStructures,
  feeTypes,
  grades,
  schoolUsers,
  schools,
  sections,
  studentConcessions,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
} from '../schema';

const SLUG = 'rehearsal-academy';
const SCHOOL_CODE = 'RHA';
/** Written into the school's address so the script can recognise its own work. */
const MARKER = 'SEEDED-BY db/seed/adversarial-school.ts';

// -----------------------------------------------------------------------------
// Deterministic randomness
//
// Seeded so two runs produce the same school. A seed that differs every time
// makes "it worked yesterday" unfalsifiable, which is the opposite of what a
// rehearsal fixture is for.
// -----------------------------------------------------------------------------

let state = 0x2545f491;

function random(): number {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return ((state >>> 0) % 100_000) / 100_000;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function chance(probability: number): boolean {
  return random() < probability;
}

// -----------------------------------------------------------------------------
// Name pools
//
// Real Pakistani names, plus the awkward ones on purpose: an apostrophe, a
// comma, a hyphen and a non-ASCII character. Each of these has broken a CSV
// export or a print stylesheet somewhere.
// -----------------------------------------------------------------------------

const FIRST_NAMES = [
  'Ayesha', 'Bilal', 'Fatima', 'Hamza', 'Zainab', 'Usman', 'Hira', 'Ali',
  'Maryam', 'Ahmed', 'Sana', 'Umar', 'Noor', 'Hassan', 'Amna', 'Zain',
  'Iqra', 'Talha', 'Areeba', 'Saad', 'Mahnoor', 'Faizan', 'Rabia', 'Danish',
  'Anaya', "Sa'ad", 'Zoë', 'Abdul-Rehman',
];

const LAST_NAMES = [
  'Khan', 'Ahmed', 'Malik', 'Iqbal', 'Hussain', 'Sheikh', 'Butt', 'Raza',
  'Siddiqui', 'Qureshi', 'Farooq', 'Chaudhry', 'Ansari', 'Bhatti',
  'Khan, Jr.',
];

const FATHER_NAMES = [
  'Muhammad', 'Abdul', 'Imran', 'Tariq', 'Nadeem', 'Kashif', 'Rizwan',
  'Shahid', 'Waseem', 'Asif', 'Naveed', 'Javed',
];

interface Ctx {
  db: ReturnType<typeof drizzle>;
  locationId: string;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  if (url.includes(':6543')) {
    throw new Error(
      'That is the transaction pooler (6543). Seeding needs the session pooler (5432) — see the docblock.',
    );
  }

  const sql = postgres(url, { prepare: false, max: 4 });
  const db = drizzle(sql);

  try {
    await reset(db);
    const locationId = await seedSchool(db);
    const ctx: Ctx = { db, locationId };

    const { mainBranch, cityBranch } = await seedBranches(ctx);
    const { lastYear, thisYear, nextYear } = await seedYears(ctx);
    const gradeRows = await seedGrades(ctx, mainBranch, cityBranch);
    const sectionRows = await seedSections(ctx, gradeRows, [lastYear, thisYear, nextYear]);
    const fees = await seedFeeHeads(ctx, gradeRows, thisYear);
    const students = await seedStudents(ctx, sectionRows, thisYear);
    await seedFees(ctx, students, fees, thisYear);

    report(students, sectionRows);
  } finally {
    await sql.end();
  }
}

/**
 * Removes the previously seeded school, and refuses to remove anything else.
 *
 * `schools.location_id` is the foreign key on 43 tables and every one of them
 * cascades, so this single delete is the whole cleanup.
 */
async function reset(db: Ctx['db']): Promise<void> {
  const existing = await db
    .select({ id: schools.id, address: schools.address, name: schools.name })
    .from(schools)
    .where(eq(schools.slug, SLUG))
    .limit(1);

  const school = existing[0];
  if (school === undefined) return;

  if (school.address === null || !school.address.includes(MARKER)) {
    throw new Error(
      `A school already exists on the slug "${SLUG}" and it was not seeded by this script ` +
        `("${school.name}"). Refusing to delete it. Change SLUG or remove that school by hand.`,
    );
  }

  await db.delete(schools).where(eq(schools.id, school.id));
  console.log(`Removed the previous ${SLUG}.`);
}

async function seedSchool(db: Ctx['db']): Promise<string> {
  const locationId = crypto.randomUUID();

  await db.insert(schools).values({
    // The tenant key is the school's own id — see STATE.md §1. GHL is opt-in
    // and this school deliberately has no sub-account.
    id: locationId,
    locationId,
    name: 'Rehearsal Academy',
    slug: SLUG,
    schoolCode: SCHOOL_CODE,
    city: 'Lahore',
    address: `12 Ferozepur Road, Lahore — ${MARKER}`,
    phone: '+924235000000',
    email: 'office@rehearsal.invalid',
    isActive: true,
  });

  return locationId;
}

async function seedBranches({ db, locationId }: Ctx) {
  const rows = await db
    .insert(branches)
    .values([
      {
        locationId,
        name: 'Main Campus',
        code: 'LHR-MAIN',
        city: 'Lahore',
        address: 'Ferozepur Road',
        isMainBranch: true,
        curriculumLevel: 'MATRIC',
      },
      {
        locationId,
        name: 'Johar Town',
        code: 'LHR-JT',
        city: 'Lahore',
        address: 'Block G, Johar Town',
        isMainBranch: false,
        curriculumLevel: 'MATRIC',
      },
    ])
    .returning({ id: branches.id, code: branches.code });

  return {
    mainBranch: rows.find((row) => row.code === 'LHR-MAIN')!.id,
    cityBranch: rows.find((row) => row.code === 'LHR-JT')!.id,
  };
}

/**
 * Three academic years, because promotion needs somewhere to go.
 *
 * Two is not enough, and finding that out took running it: the students are
 * enrolled in the *active* year, and a school promotes out of the year it is
 * in — so with only a past year and the current one there is no destination and
 * the screen correctly offers nothing. The third year is the one being
 * prepared, which is the state a school is actually in when it rolls over.
 *
 * The past year exists so enrolment history is not empty on day one.
 */
async function seedYears({ db, locationId }: Ctx) {
  const rows = await db
    .insert(academicYears)
    .values([
      {
        locationId,
        name: '2025-2026',
        startMonth: 4,
        startYear: 2025,
        endMonth: 3,
        endYear: 2026,
        isActive: false,
      },
      {
        locationId,
        name: '2026-2027',
        startMonth: 4,
        startYear: 2026,
        endMonth: 3,
        endYear: 2027,
        isActive: true,
      },
      {
        locationId,
        name: '2027-2028',
        startMonth: 4,
        startYear: 2027,
        endMonth: 3,
        endYear: 2028,
        isActive: false,
      },
    ])
    .returning({ id: academicYears.id, name: academicYears.name });

  return {
    lastYear: rows.find((row) => row.name === '2025-2026')!.id,
    thisYear: rows.find((row) => row.name === '2026-2027')!.id,
    nextYear: rows.find((row) => row.name === '2027-2028')!.id,
  };
}

const GRADE_PLAN = [
  { name: 'Grade 4', sortOrder: 40 },
  { name: 'Grade 5', sortOrder: 50 },
  { name: 'Grade 6', sortOrder: 60 },
] as const;

async function seedGrades({ db, locationId }: Ctx, mainBranch: string, cityBranch: string) {
  const values = [
    ...GRADE_PLAN.map((grade) => ({
      locationId,
      branchId: mainBranch,
      name: grade.name,
      sortOrder: grade.sortOrder,
      curriculumLevel: 'MATRIC' as const,
      isActive: true,
    })),
    // The second campus carries only the middle grade. That asymmetry is the
    // point: a transfer has to find a matching class at the other campus, and
    // a campus with every grade would never exercise the case where it cannot.
    {
      locationId,
      branchId: cityBranch,
      name: 'Grade 5',
      sortOrder: 50,
      curriculumLevel: 'MATRIC' as const,
      isActive: true,
    },
  ];

  return db
    .insert(grades)
    .values(values)
    .returning({
      id: grades.id,
      name: grades.name,
      branchId: grades.branchId,
      sortOrder: grades.sortOrder,
    });
}

type GradeRow = Awaited<ReturnType<typeof seedGrades>>[number];

async function seedSections(
  { db, locationId }: Ctx,
  gradeRows: GradeRow[],
  years: readonly string[],
) {
  const values = gradeRows.flatMap((grade) =>
    // Three sections in each grade of the main campus, one at Johar Town. A
    // single-section grade is the case promotion pre-selects a destination
    // for; a multi-section grade is the case it must not.
    (grade.branchId === gradeRows[0]!.branchId ? ['A', 'B', 'C'] : ['A']).flatMap((name) =>
      years.map((academicYearId) => ({
        locationId,
        gradeId: grade.id,
        academicYearId,
        name,
        capacity: 40,
        isActive: true,
      })),
    ),
  );

  const rows = await db
    .insert(sections)
    .values(values)
    .returning({
      id: sections.id,
      gradeId: sections.gradeId,
      academicYearId: sections.academicYearId,
      name: sections.name,
    });

  return rows.map((row) => ({
    ...row,
    grade: gradeRows.find((grade) => grade.id === row.gradeId)!,
  }));
}

type SectionRow = Awaited<ReturnType<typeof seedSections>>[number];

async function seedFeeHeads({ db, locationId }: Ctx, gradeRows: GradeRow[], thisYear: string) {
  const heads = await db
    .insert(feeTypes)
    .values([
      { locationId, name: 'Tuition Fee', feeCategory: 'monthly', sortOrder: 1 },
      { locationId, name: 'Transport', feeCategory: 'monthly', sortOrder: 2 },
      { locationId, name: 'Annual Charges', feeCategory: 'annual', sortOrder: 3 },
    ])
    .returning({ id: feeTypes.id, name: feeTypes.name });

  const tuition = heads.find((head) => head.name === 'Tuition Fee')!;
  const transport = heads.find((head) => head.name === 'Transport')!;

  // Prices rise with the grade, which is what makes a proration or a family
  // total wrong in a *visible* way if the arithmetic is wrong — every child at
  // the same price hides an off-by-one.
  await db.insert(feeStructures).values(
    gradeRows.flatMap((grade) => [
      {
        locationId,
        feeTypeId: tuition.id,
        gradeId: grade.id,
        academicYearId: thisYear,
        amount: String(3000 + grade.sortOrder * 20),
      },
      {
        locationId,
        feeTypeId: transport.id,
        gradeId: grade.id,
        academicYearId: thisYear,
        amount: '1500',
      },
    ]),
  );

  return { tuition, transport };
}

interface SeededStudent {
  profileId: string;
  name: string;
  sectionId: string;
  gradeSortOrder: number;
  tuition: number;
  concession: number;
  hasGuardian: boolean;
  reachable: boolean;
}

/**
 * ~400 students across the two campuses, with the awkward cases mixed in.
 *
 * Written directly rather than through `enrollStudent`, deliberately: that
 * function issues admission numbers from a counter one at a time and holds a
 * transaction each, which at 400 students is minutes of round trips. The seed
 * is not testing `enrollStudent` — the import already does — it is producing
 * the data everything else is tested against.
 */
async function seedStudents(
  ctx: Ctx,
  sectionRows: SectionRow[],
  thisYear: string,
): Promise<SeededStudent[]> {
  const { db, locationId } = ctx;
  const current = sectionRows.filter((section) => section.academicYearId === thisYear);

  const users: Array<typeof schoolUsers.$inferInsert> = [];
  const profiles: Array<typeof studentProfiles.$inferInsert> = [];
  const enrollments: Array<typeof studentEnrollments.$inferInsert> = [];
  const guardians: Array<typeof studentGuardians.$inferInsert> = [];
  const seeded: SeededStudent[] = [];

  /** Families that will get more than one child, keyed by phone. */
  const families: Array<{ phone: string; name: string; email: string | null }> = [];
  for (let index = 0; index < 40; index += 1) {
    families.push({
      phone: `+9230${String(20_000_00 + index).padStart(8, '0')}`,
      name: `${pick(FATHER_NAMES)} ${pick(LAST_NAMES)}`,
      // A quarter of families have no email at all. In this market that is
      // normal, and it is what `canReachGuardian` exists for.
      email: chance(0.75) ? `family${index}@example.invalid` : null,
    });
  }

  let serial = 1;

  for (const section of current) {
    // Deliberately straddles the 40-seat capacity. `capacity` is advisory —
    // the enrolment API warns rather than refuses — and a seed where every
    // section fits comfortably never exercises the warning or the "(41/40)"
    // the section pickers render.
    const size = 38 + Math.floor(random() * 7);

    for (let index = 0; index < size; index += 1) {
      const schoolUserId = crypto.randomUUID();
      const profileId = crypto.randomUUID();
      const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      const studentNumber = `${SCHOOL_CODE}-2026-${String(serial).padStart(4, '0')}`;
      serial += 1;

      // 30% of children belong to one of the 40 multi-child families, which is
      // what produces the sibling groups the family voucher needs.
      const family = chance(0.3) ? pick(families) : null;

      // 4% have no guardian recorded at all — the row an inner join silently
      // drops, and the case the aged-debt report has to still show.
      const hasGuardian = family !== null || chance(0.96);

      // A few have a guardian with neither phone nor email. The schema demands
      // a phone, so "unreachable" here means a placeholder landline nobody
      // answers and no email — which is exactly how it appears in real data.
      const reachable = family?.email != null || chance(0.8);

      users.push({
        id: schoolUserId,
        locationId,
        name,
        phone: `+9231${String(1_000_000 + serial).padStart(8, '0')}`,
        email: null,
        role: 'student',
        isActive: true,
      });

      profiles.push({
        id: profileId,
        locationId,
        schoolUserId,
        studentId: studentNumber,
        dateOfBirth: `${2013 + Math.floor(random() * 3)}-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}`,
        gender: chance(0.5) ? 'male' : 'female',
        nationality: 'Pakistani',
      });

      // A tenth join mid-term rather than on the first day of the year. Their
      // enrolment date is not the year's start, which is what attendance
      // percentages and proration both get wrong.
      const joined = chance(0.1)
        ? `2026-${String(6 + Math.floor(random() * 4)).padStart(2, '0')}-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}`
        : '2026-04-01';

      enrollments.push({
        locationId,
        studentProfileId: profileId,
        sectionId: section.id,
        academicYearId: thisYear,
        status: 'active',
        enrollmentDate: joined,
        rollNumber: String(index + 1),
      });

      if (hasGuardian) {
        guardians.push({
          locationId,
          studentProfileId: profileId,
          name: family?.name ?? `${pick(FATHER_NAMES)} ${pick(LAST_NAMES)}`,
          relationship: 'father',
          phone: family?.phone ?? `+9232${String(2_000_000 + serial).padStart(8, '0')}`,
          email: family?.email ?? (reachable ? `parent${serial}@example.invalid` : null),
          isPrimaryContact: true,
        });
      }

      seeded.push({
        profileId,
        name,
        sectionId: section.id,
        gradeSortOrder: section.grade.sortOrder,
        tuition: 3000 + section.grade.sortOrder * 20,
        // 15% hold a concession, so a challan total is not the price list's
        // sum — the case a report that recomputes instead of reading gets
        // wrong.
        concession: chance(0.15) ? 500 + Math.floor(random() * 5) * 100 : 0,
        hasGuardian,
        reachable,
      });
    }
  }

  await insertInChunks(db, schoolUsers, users);
  await insertInChunks(db, studentProfiles, profiles);
  await insertInChunks(db, studentEnrollments, enrollments);
  await insertInChunks(db, studentGuardians, guardians);

  return seeded;
}

/**
 * Fee challans for three months, with the awkward payment states.
 *
 * Three months rather than one so the aged-debt buckets have something to
 * separate: one month of arrears puts everybody in the same bucket and the
 * report looks like it works when it has not been tested.
 */
async function seedFees(
  { db, locationId }: Ctx,
  students: SeededStudent[],
  fees: Awaited<ReturnType<typeof seedFeeHeads>>,
  thisYear: string,
): Promise<void> {
  const challans: Array<typeof feeChallans.$inferInsert> = [];
  const items: Array<typeof feeChallanItems.$inferInsert> = [];
  const payments: Array<typeof feePayments.$inferInsert> = [];
  const concessions: Array<typeof studentConcessions.$inferInsert> = [];

  // June, July and August 2026, due on the 10th. August is barely overdue,
  // June is three months old — one row per bucket without contriving dates.
  const months = [
    { month: 6, due: '2026-06-10' },
    { month: 7, due: '2026-07-10' },
    { month: 8, due: '2026-08-10' },
  ];

  let serial = 1;

  for (const student of students) {
    if (student.concession > 0) {
      concessions.push({
        locationId,
        studentProfileId: student.profileId,
        discountType: 'fixed',
        discountValue: String(student.concession),
        concessionName: 'Sibling discount',
        validFrom: '2026-04-01',
      });
    }

    for (const period of months) {
      const subtotal = student.tuition + 1500;
      const total = subtotal - student.concession;

      const challanId = crypto.randomUUID();

      /*
       * Payment state, and why the mix matters.
       *
       * A tenth of challans are partly paid. `paid_amount` strictly between
       * zero and the total is the state most fee code forgets: it is neither
       * `unpaid` nor `paid`, it must not appear as settled on a report, and it
       * must carry its remainder into the aged buckets. Seeding only the two
       * clean states would leave every one of those paths unexercised.
       */
      const roll = random();
      const paid =
        period.month === 8 ? (roll < 0.4 ? total : roll < 0.5 ? Math.floor(total / 2) : 0)
        : period.month === 7 ? (roll < 0.65 ? total : roll < 0.75 ? Math.floor(total / 3) : 0)
        : roll < 0.85 ? total : roll < 0.92 ? Math.floor(total / 2) : 0;

      challans.push({
        id: challanId,
        locationId,
        studentProfileId: student.profileId,
        academicYearId: thisYear,
        challanNumber: `${SCHOOL_CODE}-2026-${String(period.month).padStart(2, '0')}-${String(serial).padStart(4, '0')}`,
        billingMonth: period.month,
        billingYear: 2026,
        dueDate: period.due,
        issueDate: `2026-${String(period.month).padStart(2, '0')}-01`,
        subtotal: String(subtotal),
        concessionAmount: String(student.concession),
        totalAmount: String(total),
        paidAmount: String(paid),
        status: paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
      });

      items.push(
        {
          locationId,
          challanId,
          feeTypeId: fees.tuition.id,
          description: 'Tuition Fee',
          amount: String(student.tuition),
          netAmount: String(student.tuition),
        },
        {
          locationId,
          challanId,
          feeTypeId: fees.transport.id,
          description: 'Transport',
          amount: '1500',
          netAmount: '1500',
        },
      );

      if (paid > 0) {
        payments.push({
          locationId,
          challanId,
          amount: String(paid),
          paymentMethod: chance(0.7) ? 'cash' : 'bank_transfer',
          paymentDate: period.due,
          collectedByUid: 'seed',
        });
      }

      serial += 1;
    }
  }

  await insertInChunks(db, studentConcessions, concessions);
  await insertInChunks(db, feeChallans, challans);
  await insertInChunks(db, feeChallanItems, items);
  await insertInChunks(db, feePayments, payments);
}

/**
 * Inserts in batches.
 *
 * Postgres caps a statement at 65535 bound parameters, and 1200 challans of 18
 * columns each clears that comfortably. The failure is a driver error naming
 * neither the table nor the cause, so the chunking is not an optimisation.
 */
async function insertInChunks<T extends Record<string, unknown>>(
  db: Ctx['db'],
  table: Parameters<Ctx['db']['insert']>[0],
  values: T[],
  size = 500,
): Promise<void> {
  for (let index = 0; index < values.length; index += size) {
    const chunk = values.slice(index, index + size);
    if (chunk.length === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(table).values(chunk as any);
  }
}

function report(students: SeededStudent[], sectionRows: SectionRow[]): void {
  const withoutGuardian = students.filter((student) => !student.hasGuardian).length;
  const unreachable = students.filter(
    (student) => student.hasGuardian && !student.reachable,
  ).length;
  const withConcession = students.filter((student) => student.concession > 0).length;

  // Sections exist once per academic year, so the distinct count is what a
  // person means by "how many classes" — not the row count.
  const classes = new Set(sectionRows.map((row) => `${row.gradeId}:${row.name}`)).size;

  console.log(`
Seeded "Rehearsal Academy" (${SLUG}):
  ${students.length} students across ${classes} classes and 2 campuses
  ${withoutGuardian} with no guardian recorded
  ${unreachable} whose guardian has no email address
  ${withConcession} holding a concession
  3 months of challans — paid, partly paid and unpaid

Sign in as a platform operator and use "Login as Admin", or add an
administrator from the Super Admin school page. The Admissions and Fee
Management modules must be switched on before any of it is reachable.
`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
