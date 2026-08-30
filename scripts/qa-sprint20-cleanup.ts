/**
 * Undoes everything the Sprint 20 QA run wrote to the shared database.
 *
 * §5bg's lesson: QA shares a database with production, and it left a 5,000
 * credit at LGS that needed a human's DELETE. Every row this run created is
 * removed here, and the voucher it repriced is put back through the product's
 * **own** `repriceOpenChallans` rather than by writing figures at the columns —
 * a hand-restored total and a recomputed one are not guaranteed to agree, and
 * the one that matters is the one the fee module would produce.
 */
import { readFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL !== undefined) return;
  const text = readFileSync('D:/School-Management-System/.env.local', 'utf8');
  const match = /^DATABASE_URL=(.*)$/m.exec(text);
  if (match?.[1] === undefined) throw new Error('DATABASE_URL not found');
  process.env.DATABASE_URL = match[1].trim().replace(/^['"]|['"]$/g, '');
}
loadDatabaseUrl();

const LOCATION = '21fad594-7996-4ad6-8117-3386972eb454';
const STUDENT_11 = '5447bb84-64e3-42bc-b496-93041c226d70';
const TEMP_SCHEMES = [
  '96bc3a1f-a503-4784-a81f-a3036c5f7d2a',
  '852c2355-e7e8-42bd-b04f-3732f04670b4',
  '84b9f4c6-c2fb-4a3d-8d31-7f4eca64cc88',
];

async function main(): Promise<void> {
  const { db } = await import('../lib/drizzle');
  const { bankAccounts, concessionSchemes, schools, studentConcessions, feeChallans } =
    await import('../db/schema');
  const { repriceOpenChallans } = await import('../lib/fee-challans');

  // 1. The grant this run made, hard-deleted rather than closed: it was never
  //    the school's decision, so leaving a dated row would be inventing history.
  const grants = await db
    .delete(studentConcessions)
    .where(
      and(
        eq(studentConcessions.locationId, LOCATION),
        inArray(studentConcessions.schemeId, TEMP_SCHEMES),
      ),
    )
    .returning({ id: studentConcessions.id, name: studentConcessions.concessionName });
  console.log(`grants removed: ${String(grants.length)}`, grants.map((g) => g.name));

  // 2. Put the voucher back through the module's own pricing.
  const reprice = await repriceOpenChallans(db, {
    locationId: LOCATION,
    studentProfileId: STUDENT_11,
    actorUid: 'qa-sprint20-cleanup',
  });
  console.log(`vouchers repriced: ${String(reprice.repriced.length)}`);

  // 3. The three temporary schemes.
  const schemes = await db
    .delete(concessionSchemes)
    .where(
      and(
        eq(concessionSchemes.locationId, LOCATION),
        inArray(concessionSchemes.id, TEMP_SCHEMES),
      ),
    )
    .returning({ name: concessionSchemes.name });
  console.log(`schemes removed: ${String(schemes.length)}`, schemes.map((s) => s.name));

  // 4. The scheme this run reclassified, back to what `0037` backfilled.
  await db
    .update(concessionSchemes)
    .set({ schemeType: 'other' })
    .where(
      and(
        eq(concessionSchemes.locationId, LOCATION),
        eq(concessionSchemes.name, 'Siblings Discount'),
      ),
    );
  console.log('“Siblings Discount” restored to scheme_type = other');

  // 5. The three bank accounts, which were invented for the print test.
  const banks = await db
    .delete(bankAccounts)
    .where(eq(bankAccounts.locationId, LOCATION))
    .returning({ name: bankAccounts.bankName });
  console.log(`bank accounts removed: ${String(banks.length)}`, banks.map((b) => b.name));

  // 6. The three school fields, whose values came from the sample PDF.
  await db
    .update(schools)
    .set({ ntn: null, website: null, financeEmail: null })
    .where(eq(schools.locationId, LOCATION));
  console.log('schools.ntn / .website / .finance_email cleared');

  // 7. Read it all back, because a delete that reported success and a database
  //    that is actually clean are two different claims.
  const [leftBanks, leftSchemes, leftGrants, voucher, school] = await Promise.all([
    db.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.locationId, LOCATION)),
    db
      .select({ name: concessionSchemes.name, type: concessionSchemes.schemeType })
      .from(concessionSchemes)
      .where(eq(concessionSchemes.locationId, LOCATION)),
    db
      .select({ name: studentConcessions.concessionName })
      .from(studentConcessions)
      .where(eq(studentConcessions.studentProfileId, STUDENT_11)),
    db
      .select({
        number: feeChallans.challanNumber,
        status: feeChallans.status,
        concession: feeChallans.concessionAmount,
        total: feeChallans.totalAmount,
      })
      .from(feeChallans)
      .where(eq(feeChallans.studentProfileId, STUDENT_11)),
    db
      .select({ ntn: schools.ntn, website: schools.website, finance: schools.financeEmail })
      .from(schools)
      .where(eq(schools.locationId, LOCATION)),
  ]);

  console.log('\n--- read back ---');
  console.log('bank_accounts rows:', leftBanks.length);
  console.log('schemes:', leftSchemes);
  console.log('grants on Student 11:', leftGrants.map((g) => g.name));
  console.log('Student 11 vouchers:', voucher);
  console.log('school fields:', school[0]);

  process.exit(0);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
