/**
 * Prints the SQL of the statements Sprint 20 added or changed that join more
 * than three tables, or that carry a raw-`sql` alias.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 * CLAUDE.md: *"Read the generated SQL when a statement joins more than three
 * tables. It is one `console.log(query.toSQL())` and it is the only evidence
 * that exists."* Three shipped defects (§5av, §5bg, §5bh) are all the same
 * class — Drizzle renders a raw-`sql` subquery column **unqualified**, and a
 * selection key never reaches the SQL at all — and none of them is visible to a
 * type-checker, a linter or a passing build.
 *
 * It **connects to nothing**. `toSQL()` compiles the statement in this process;
 * `postgres()` is lazy and opens no socket until a query is awaited. So this
 * runs anywhere, including CI, and answers the one question a green build
 * cannot: what Postgres would actually be asked.
 *
 *   npx esbuild scripts/print-sprint20-sql.ts --bundle --platform=node \
 *     --format=esm --packages=external \
 *     --outfile=node_modules/.cache/print-sql.mjs && node node_modules/.cache/print-sql.mjs
 *
 * Kept in the repository rather than run once and deleted, because the next
 * person to add a join to one of these statements needs the same evidence and
 * should not have to rebuild the harness to get it.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../db/schema';

const {
  academicYears,
  bankAccounts,
  branches,
  concessionSchemes,
  grades,
  lateFeeRules,
  schoolUsers,
  sections,
  studentConcessions,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
} = schema;

// Never connected. `postgres()` opens no socket until a query is awaited, and
// nothing here is awaited.
const db = drizzle(postgres('postgres://never:connected@127.0.0.1:1/none'), { schema });

const LOCATION = 'LOCATION';

function show(title: string, query: { toSQL: () => { sql: string; params: unknown[] } }): void {
  const compiled = query.toSQL();
  console.log(`\n=== ${title} ===\n${compiled.sql}\n  params: ${JSON.stringify(compiled.params)}`);
}

/* -----------------------------------------------------------------------------
 * 1. `listSchoolUsers`, item 1.
 *
 * The one statement in this sprint carrying a raw-`sql` ordered aggregate, and
 * therefore the one the 42702 class could bite. `school_users` is joined and has
 * a `phone`; the aggregate is aliased `student_guardian_phone`, which nothing
 * else in the statement has, and the outer reference is written out qualified.
 * -------------------------------------------------------------------------- */

const studentContact = db
  .select({
    schoolUserId: studentProfiles.schoolUserId,
    phone:
      sql<string>`(array_agg(${studentGuardians.phone} order by ${studentGuardians.isPrimaryContact} desc, ${studentGuardians.createdAt} asc))[1]`.as(
        'student_guardian_phone',
      ),
  })
  .from(studentGuardians)
  .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
  .where(eq(studentGuardians.locationId, LOCATION))
  .groupBy(studentProfiles.schoolUserId)
  .as('student_contact');

show(
  'listSchoolUsers — the page query',
  db
    .select({
      id: schoolUsers.id,
      name: schoolUsers.name,
      phone: schoolUsers.phone,
      role: schoolUsers.role,
      branchName: branches.name,
      guardianPhone: sql<string | null>`"student_contact"."student_guardian_phone"`,
    })
    .from(schoolUsers)
    .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
    .leftJoin(studentContact, eq(studentContact.schoolUserId, schoolUsers.id))
    .where(eq(schoolUsers.locationId, LOCATION))
    .orderBy(asc(schoolUsers.name)),
);

/* -----------------------------------------------------------------------------
 * 2. `enrolledFamily`, items 8 and 9a. Six tables, every column plain.
 * -------------------------------------------------------------------------- */

show(
  'enrolledFamily — the sibling ranking',
  db
    .select({
      studentProfileId: studentProfiles.id,
      studentId: studentProfiles.studentId,
      name: schoolUsers.name,
      enrollmentDate: studentEnrollments.enrollmentDate,
      branchId: grades.branchId,
      branchName: branches.name,
    })
    .from(studentEnrollments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentEnrollments.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .where(
      and(
        eq(studentEnrollments.locationId, LOCATION),
        eq(studentEnrollments.status, 'active'),
        eq(studentEnrollments.academicYearId, 'YEAR'),
        inArray(studentEnrollments.studentProfileId, ['A', 'B']),
      ),
    )
    .orderBy(asc(studentEnrollments.enrollmentDate), asc(studentProfiles.studentId)),
);

/* -----------------------------------------------------------------------------
 * 3. `openSiblingGrants`, item 9b. Three tables, and `late_fee_rules` is a LEFT
 *    join on purpose — a school with no settings row has never chosen.
 * -------------------------------------------------------------------------- */

show(
  'openSiblingGrants — the sweep candidates',
  db
    .select({
      concessionId: studentConcessions.id,
      locationId: studentConcessions.locationId,
      studentProfileId: studentConcessions.studentProfileId,
      validUntil: studentConcessions.validUntil,
    })
    .from(studentConcessions)
    .innerJoin(
      concessionSchemes,
      and(
        eq(concessionSchemes.id, studentConcessions.schemeId),
        eq(concessionSchemes.schemeType, 'sibling'),
      ),
    )
    .leftJoin(lateFeeRules, eq(lateFeeRules.locationId, studentConcessions.locationId)),
);

/* -----------------------------------------------------------------------------
 * 4. `listVoucherBankAccounts`, item 10 and 11. Two tables, but the predicate is
 *    `sharedOrOwnedBy` — a null `branch_id` means shared, and `eq` here would
 *    print a voucher with no bank block at every school.
 * -------------------------------------------------------------------------- */

show(
  'listVoucherBankAccounts',
  db
    .select({
      id: bankAccounts.id,
      bankName: bankAccounts.bankName,
      branchName: branches.name,
    })
    .from(bankAccounts)
    .leftJoin(branches, eq(branches.id, bankAccounts.branchId))
    .where(
      and(
        eq(bankAccounts.locationId, LOCATION),
        eq(bankAccounts.isActive, true),
        inArray(bankAccounts.purpose, ['student', 'both']),
      ),
    )
    .orderBy(asc(bankAccounts.sortOrder), asc(bankAccounts.bankName)),
);

/* -----------------------------------------------------------------------------
 * 5. `listSiblings`'s campus join, item 8. Six tables; the point is that
 *    `branches` is joined for a *column* and appears in no predicate.
 * -------------------------------------------------------------------------- */

show(
  'listSiblings — with the campus column',
  db
    .selectDistinctOn([schoolUsers.name, studentProfiles.id], {
      studentProfileId: studentProfiles.id,
      name: schoolUsers.name,
      gradeName: grades.name,
      branchId: grades.branchId,
      branchName: branches.name,
      enrollmentStatus: studentEnrollments.status,
    })
    .from(studentGuardians)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .leftJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, studentProfiles.id),
        eq(studentEnrollments.locationId, LOCATION),
        eq(studentEnrollments.status, 'active'),
        eq(studentEnrollments.academicYearId, 'YEAR'),
      ),
    )
    .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .leftJoin(grades, eq(grades.id, sections.gradeId))
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .where(eq(studentGuardians.locationId, LOCATION))
    .orderBy(asc(schoolUsers.name), asc(studentProfiles.id)),
);

/* -----------------------------------------------------------------------------
 * 6. `getChallanDetail`'s header, item 11. Eight tables after this sprint, which
 *    is the widest statement the fee module has.
 * -------------------------------------------------------------------------- */

show(
  'getChallanDetail — the header',
  db
    .select({
      studentName: schoolUsers.name,
      studentEmail: schoolUsers.email,
      schoolName: schema.schools.name,
      schoolNtn: schema.schools.ntn,
      schoolWebsite: schema.schools.website,
      schoolFinanceEmail: schema.schools.financeEmail,
      branchId: grades.branchId,
      branchName: branches.name,
      branchAddress: branches.address,
      academicYearName: academicYears.name,
    })
    .from(schema.feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, schema.feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(academicYears, eq(academicYears.id, schema.feeChallans.academicYearId))
    .innerJoin(schema.schools, eq(schema.schools.locationId, schema.feeChallans.locationId))
    .leftJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, schema.feeChallans.studentProfileId),
        eq(studentEnrollments.academicYearId, schema.feeChallans.academicYearId),
      ),
    )
    .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .leftJoin(grades, eq(grades.id, sections.gradeId))
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .where(eq(schema.feeChallans.locationId, LOCATION)),
);

console.log('\nNothing above was executed. Read the SQL.');
