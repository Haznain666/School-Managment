import 'server-only';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  familyChallans,
  feeChallans,
  feePayments,
  schoolUsers,
  schools,
  studentGuardians,
  studentProfiles,
  OPEN_CHALLAN_STATUSES,
} from '@/db/schema';

import { generateChallanNumber } from './challan-number';
import { formatMonthYear } from './dates';
import { db } from './drizzle';
import { sendFeeVouchers } from './fee-notices';
import { formatPkr, paiseToNumeric, toPaise } from './money';
import { normalizeCnic } from './national-id';

/**
 * One voucher for a parent with several children at the school.
 *
 * ── What "a family" is here ─────────────────────────────────────────────
 * `student_guardians` holds one row per guardian **per child**, so a father
 * with three children is three rows. Two of those rows are the same person when
 * they share a **CNIC** or a **phone number** — the sibling rule, defined once
 * in `lib/siblings.ts` and applied here so that the voucher groups exactly the
 * children every other screen calls siblings.
 *
 * ── Why the two keys are unioned rather than ranked ──────────────────────
 * Until 2026-08-20 this grouped on the phone number alone. Simply promoting
 * CNIC over phone would have *split* families rather than merged them: a father
 * recorded with his CNIC on his new child's record and without it on the elder
 * one — which is every family enrolled before today plus one new admission —
 * would come out as two guardians and two vouchers, a regression shipped as an
 * improvement.
 *
 * So the rows are unioned: any two rows sharing either key are one person, and
 * transitively so. The CNIC on the new row and the phone on the old row link
 * the two halves of that father into one family, which is the correct answer
 * and the one the school would give.
 *
 * It stays fallible in the way it always was: two unrelated guardians sharing a
 * handset become one family. That is rare, and visible on the voucher — the
 * children's names are printed on it. Every CNIC collected makes it rarer.
 *
 * ── The per-child challans stay, and stay authoritative ─────────────────
 * Fee reports, the defaulter list, concessions and a student's own ledger are
 * all per student. A family voucher is a **payment convenience**, not a change
 * to who is billed. It carries the total and receives the payment; the child
 * challans carry the detail.
 */

export interface FamilyMember {
  challanId: string;
  studentProfileId: string;
  studentName: string;
  studentNumber: string;
  challanNumber: string;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  status: string;
}

/**
 * Open challans for one billing period, grouped by guardian phone.
 *
 * Only groups of two or more come back: a single child does not need a family
 * voucher and issuing one would put a second number on the same debt for no
 * reason. Challans already folded into a voucher are excluded, which is what
 * makes a second run for the same month safe.
 */
/** A family as the grouping produces it, before any screen narrows it. */
interface OpenFamily {
  guardianId: string;
  guardianName: string;
  phone: string;
  email: string | null;
  /** Every guardian row folded into this family, for a lookup by any of them. */
  guardianIds: string[];
  members: FamilyMember[];
  children: Array<{ studentProfileId: string; studentName: string; studentNumber: string }>;
  openMonths: Array<{
    billingMonth: number;
    billingYear: number;
    count: number;
    total: string;
  }>;
  openTotal: string;
}

/**
 * Every open, ungrouped challan in the school, folded into families.
 *
 * ── One rule, one implementation ─────────────────────────────────────────
 * This is the union-find, and it is shared by the month listing, the wizard's
 * search and the wizard's third step. It was inlined in the month listing
 * until Sprint 18 added the other two callers; copying it would have been three
 * definitions of "the same family", and the first divergence between them would
 * be a family the search offers and the generator then refuses to club.
 *
 * Each guardian row contributes up to two keys — `phone:+923001234567` and
 * `cnic:42101-1234567-1` — and every key a row carries is merged into one set.
 * Two rows sharing *either* key land in the same family, and so do two rows
 * that share nothing directly but are both linked to a third. That transitivity
 * is why this is a union-find and not a `Map` keyed on `cnic ?? phone`: the
 * father whose elder child predates CNIC collection is reachable from his newer
 * record only through the number they have in common.
 *
 * It stays fallible in the way it always was: two unrelated guardians sharing a
 * handset become one family. That is rare, and visible — the children's names
 * are printed on the voucher. Every CNIC collected makes it rarer.
 */
async function groupOpenChallans(
  locationId: string,
  period?: { billingMonth: number; billingYear: number },
): Promise<OpenFamily[]> {
  const conditions = [
    eq(feeChallans.locationId, locationId),
    inArray(feeChallans.status, [...OPEN_CHALLAN_STATUSES]),
    // Already on a voucher, so it is somebody else's now. This is what makes a
    // second run for the same month safe.
    isNull(feeChallans.familyChallanId),
  ];

  if (period !== undefined) {
    conditions.push(eq(feeChallans.billingMonth, period.billingMonth));
    conditions.push(eq(feeChallans.billingYear, period.billingYear));
  }

  const rows = await db
    .select({
      challanId: feeChallans.id,
      studentProfileId: studentProfiles.id,
      studentName: schoolUsers.name,
      studentNumber: studentProfiles.studentId,
      challanNumber: feeChallans.challanNumber,
      billingMonth: feeChallans.billingMonth,
      billingYear: feeChallans.billingYear,
      dueDate: feeChallans.dueDate,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
      status: feeChallans.status,
      guardianId: studentGuardians.id,
      guardianName: studentGuardians.name,
      phone: studentGuardians.phone,
      email: studentGuardians.email,
      cnic: studentGuardians.cnic,
    })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(
      studentGuardians,
      and(
        eq(studentGuardians.studentProfileId, studentProfiles.id),
        // The contact the school actually writes to. Without this a child with
        // a father and a mother recorded would appear in two families.
        eq(studentGuardians.isPrimaryContact, true),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(studentGuardians.phone), asc(schoolUsers.name));

  const parent = new Map<string, string>();

  const find = (key: string): string => {
    let root = parent.get(key) ?? key;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;

    // Path compression, so a school with a thousand challans does not walk the
    // chain once per row.
    let walk = key;
    while (walk !== root) {
      const next = parent.get(walk) ?? walk;
      parent.set(walk, root);
      walk = next;
    }

    return root;
  };

  const union = (left: string, right: string): void => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(a, b);
  };

  const keysFor = (row: { phone: string; cnic: string | null }): string[] => {
    const keys = [`phone:${row.phone}`];

    // Only a whole, canonical CNIC is a key. A half-recorded number must never
    // match another half-recorded number — that would invent a family.
    const cnic = normalizeCnic(row.cnic);
    if (cnic !== null) keys.push(`cnic:${cnic}`);

    return keys;
  };

  for (const row of rows) {
    const keys = keysFor(row);
    for (const key of keys) find(key);
    for (const key of keys.slice(1)) union(keys[0] ?? key, key);
  }

  const byFamily = new Map<string, OpenFamily>();

  for (const row of rows) {
    const key = find(keysFor(row)[0] ?? `phone:${row.phone}`);

    const family = byFamily.get(key) ?? {
      // The first row in the ordering names the family. Rows are ordered by
      // phone then student name, so the same family is described the same way
      // on every run rather than by whichever child sorted first this month.
      guardianId: row.guardianId,
      guardianName: row.guardianName,
      phone: row.phone,
      email: row.email,
      guardianIds: [],
      members: [],
      children: [],
      openMonths: [],
      openTotal: '0',
    };

    if (!family.guardianIds.includes(row.guardianId)) {
      family.guardianIds.push(row.guardianId);
    }

    family.members.push({
      challanId: row.challanId,
      studentProfileId: row.studentProfileId,
      studentName: row.studentName,
      studentNumber: row.studentNumber,
      challanNumber: row.challanNumber,
      dueDate: row.dueDate,
      totalAmount: row.totalAmount,
      paidAmount: row.paidAmount,
      status: row.status,
    });

    if (!family.children.some((child) => child.studentProfileId === row.studentProfileId)) {
      family.children.push({
        studentProfileId: row.studentProfileId,
        studentName: row.studentName,
        studentNumber: row.studentNumber,
      });
    }

    byFamily.set(key, family);
  }

  /*
   * The billing period of each challan, looked up once.
   *
   * `FamilyMember` deliberately does not carry a month — it is the shape the
   * voucher's own member list has always had — so the period comes from the
   * rows. Indexed by challan id rather than re-scanned per family, which would
   * be one pass over every open challan in the school for every family in it.
   */
  const periods = new Map<string, { billingMonth: number; billingYear: number }>();
  for (const row of rows) {
    if (row.billingMonth === null || row.billingYear === null) continue;
    periods.set(row.challanId, {
      billingMonth: row.billingMonth,
      billingYear: row.billingYear,
    });
  }

  return [...byFamily.values()].map((family) => {
    const months = new Map<
      string,
      { billingMonth: number; billingYear: number; count: number; paise: number }
    >();

    for (const member of family.members) {
      // A one-off challan carries no month and can never be clubbed — the
      // generator refuses it — so it is left out of the picker rather than
      // offered as a period nobody can act on.
      const period = periods.get(member.challanId);
      if (period === undefined) continue;

      const key = `${String(period.billingYear)}-${String(period.billingMonth)}`;
      const bucket = months.get(key) ?? { ...period, count: 0, paise: 0 };
      bucket.count += 1;
      bucket.paise += toPaise(member.totalAmount) - toPaise(member.paidAmount);
      months.set(key, bucket);
    }

    return {
      ...family,
      openMonths: [...months.values()]
        .sort(
          (left, right) =>
            right.billingYear - left.billingYear || right.billingMonth - left.billingMonth,
        )
        .map((month) => ({
          billingMonth: month.billingMonth,
          billingYear: month.billingYear,
          count: month.count,
          total: paiseToNumeric(month.paise),
        })),
      openTotal: sumMoney(family.members.map((member) => member.totalAmount)),
    };
  });
}

/** Adds money strings in integer paisa, so a hundred challans do not drift. */
function sumMoney(values: readonly string[]): string {
  const paisa = values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0);
  return (paisa / 100).toFixed(2);
}

/**
 * Splits one family payment across the children's own balances, **evenly**.
 *
 * ── Why not oldest-first, which is what this did ─────────────────────────
 * Retiring the eldest child's voucher completely before touching the next is
 * what a clerk does with a pile of separate slips, and it is the wrong answer
 * once the family is paying against *one* voucher: a parent handing over half
 * the family total expects half of each child's bill to be settled, not one
 * child cleared and two untouched. The visible consequence was a defaulters
 * list that showed two of three siblings owing everything on the day the
 * family paid — a school ringing them about it is a school that looks like it
 * has lost the money.
 *
 * ── The rule, in order ───────────────────────────────────────────────────
 * 1. An equal share to every child who still owes something.
 * 2. Capped at what that child actually owes — nobody is overpaid.
 * 3. Whatever a capped child could not absorb is redistributed over the rest,
 *    and the whole thing repeats. Two rounds settle almost every real case;
 *    the loop is there for the third.
 * 4. The remainder — always fewer paise than there are children, because the
 *    share is a floor — goes to the **largest outstanding balance**, so the sum
 *    is exact to the paisa and the odd paisa lands where it is least visible.
 *
 * Integer paise throughout, per `lib/money.ts`. Splitting rupees as doubles is
 * how a three-way split of 100.00 becomes 99.99.
 *
 * @param balances  What each child still owes, in paise, in member order.
 * @param amountPaise  The payment. Must not exceed the sum of `balances`; the
 *   caller checks that, because it has the message to show when it does.
 * @returns What to apply to each child, in the same order. Sums to
 *   `amountPaise` exactly.
 */
export function spreadEvenly(
  balances: readonly number[],
  amountPaise: number,
): number[] {
  const applied = balances.map(() => 0);
  let remaining = Math.max(0, Math.trunc(amountPaise));

  while (remaining > 0) {
    // Everybody who still owes something and has not been capped.
    const eligible = balances
      .map((balance, index) => ({ index, left: balance - (applied[index] ?? 0) }))
      .filter((entry) => entry.left > 0);

    if (eligible.length === 0) break;

    const share = Math.floor(remaining / eligible.length);

    if (share === 0) {
      /*
       * Fewer paise left than there are children. They go to the largest
       * outstanding balance rather than to the first child in the list: a
       * paisa on the biggest bill is invisible, and a paisa handed to whoever
       * happens to sort first is a rule nobody can predict.
       */
      const largest = eligible.reduce((best, entry) =>
        entry.left > best.left ? entry : best,
      );
      const take = Math.min(remaining, largest.left);
      applied[largest.index] = (applied[largest.index] ?? 0) + take;
      remaining -= take;
      break;
    }

    for (const entry of eligible) {
      const take = Math.min(share, entry.left);
      applied[entry.index] = (applied[entry.index] ?? 0) + take;
      remaining -= take;
    }
  }

  return applied;
}

export class FamilyChallanError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'FamilyChallanError';
    this.status = status;
  }
}

/**
 * Issues one family voucher over a set of the school's own open challans.
 *
 * The member list is re-read and re-checked here rather than trusted from the
 * request: the browser may have been holding a stale group, and folding a
 * challan that has since been paid into a voucher would demand money twice.
 */
export async function createFamilyChallan(params: {
  locationId: string;
  actorUid: string;
  guardianId: string;
  challanIds: readonly string[];
  dueDate: string;
}): Promise<{ id: string; challanNumber: string; total: string; members: number }> {
  const { locationId, guardianId, challanIds, dueDate, actorUid } = params;

  if (challanIds.length < 2) {
    throw new FamilyChallanError('A family voucher needs at least two challans.');
  }

  const guardianRows = await db
    .select({
      id: studentGuardians.id,
      name: studentGuardians.name,
      phone: studentGuardians.phone,
      email: studentGuardians.email,
    })
    .from(studentGuardians)
    .where(
      and(eq(studentGuardians.locationId, locationId), eq(studentGuardians.id, guardianId)),
    )
    .limit(1);

  const guardian = guardianRows[0];
  if (guardian === undefined) {
    throw new FamilyChallanError('That guardian is not recorded at this school.', 404);
  }

  const members = await db
    .select({
      id: feeChallans.id,
      academicYearId: feeChallans.academicYearId,
      billingMonth: feeChallans.billingMonth,
      billingYear: feeChallans.billingYear,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
      familyChallanId: feeChallans.familyChallanId,
      status: feeChallans.status,
    })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        inArray(feeChallans.id, [...challanIds]),
      ),
    );

  if (members.length !== challanIds.length) {
    throw new FamilyChallanError('One of those challans is not at this school.', 404);
  }

  const alreadyGrouped = members.find((member) => member.familyChallanId !== null);
  if (alreadyGrouped !== undefined) {
    throw new FamilyChallanError('One of those challans is already on a family voucher.');
  }

  const closed = members.find(
    (member) => !(OPEN_CHALLAN_STATUSES as readonly string[]).includes(member.status),
  );
  if (closed !== undefined) {
    throw new FamilyChallanError(
      'One of those challans has been paid, cancelled or waived since the list was drawn. Refresh and try again.',
    );
  }

  // All of one month, or the total on the voucher describes nothing a parent
  // can check against the slips they were given.
  const first = members[0]!;
  const mixed = members.some(
    (member) =>
      member.billingMonth !== first.billingMonth ||
      member.billingYear !== first.billingYear ||
      member.academicYearId !== first.academicYearId,
  );
  if (mixed) {
    throw new FamilyChallanError(
      'A family voucher covers one billing month. Those challans are from different months.',
    );
  }

  if (first.billingMonth === null || first.billingYear === null) {
    throw new FamilyChallanError(
      'One-off challans are not grouped into a family voucher — they have no billing month to share.',
    );
  }

  const schoolRows = await db
    .select({ schoolCode: schools.schoolCode })
    .from(schools)
    .where(eq(schools.locationId, locationId))
    .limit(1);

  const schoolCode = schoolRows[0]?.schoolCode;
  if (schoolCode === null || schoolCode === undefined || schoolCode === '') {
    throw new FamilyChallanError(
      'This school has no school code, so voucher numbers cannot be issued.',
      409,
    );
  }

  // `F-` marks it as a family voucher at a glance, on a slip a bank teller
  // reads aloud. The sequence is shared with ordinary challans on purpose:
  // two counters could hand the same digits to two different documents.
  const base = await generateChallanNumber(
    db,
    locationId,
    schoolCode,
    first.billingMonth,
    first.billingYear,
  );
  const challanNumber = base.replace(/^([A-Z0-9]+)-/, '$1-F-');

  const total = sumMoney(members.map((member) => member.totalAmount));
  const paid = sumMoney(members.map((member) => member.paidAmount));

  const id = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(familyChallans).values({
      id,
      locationId,
      guardianId,
      academicYearId: first.academicYearId,
      challanNumber,
      billingMonth: first.billingMonth,
      billingYear: first.billingYear,
      dueDate,
      totalAmount: total,
      // Part payments made against a child challan before it was grouped
      // carry over, or the voucher would demand money the school has.
      paidAmount: paid,
      status: Number(paid) > 0 ? 'partial' : 'unpaid',
      generatedByUid: actorUid,
    });

    await tx
      .update(feeChallans)
      .set({ familyChallanId: id, updatedAt: new Date() })
      .where(inArray(feeChallans.id, [...challanIds]));
  });

  /*
   * Item 6a, for the family case.
   *
   * One email, to the guardian the voucher was issued to, naming each child's
   * own voucher as a line. Sending it per child's primary contact would put the
   * same slip in the same inbox three times, which is the opposite of what a
   * family voucher is for.
   */
  const memberNames = await db
    .select({
      challanNumber: feeChallans.challanNumber,
      studentName: schoolUsers.name,
      totalAmount: feeChallans.totalAmount,
    })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(inArray(feeChallans.id, [...challanIds]));

  void sendFeeVouchers(db, locationId, [
    {
      studentProfileId: '',
      studentName: guardian.name,
      guardian,
      challanNumber,
      periodLabel: formatMonthYear(first.billingMonth, first.billingYear),
      dueDate,
      totalAmount: total,
      items: memberNames.map((member) => ({
        description: `${member.studentName} (${member.challanNumber})`,
        netAmount: member.totalAmount,
      })),
    },
  ]).catch((error: unknown) => {
    console.warn(`[family-challans] voucher email could not be queued at ${locationId}:`, error);
  });

  return { id, challanNumber, total, members: members.length };
}

/**
 * Records a payment against a family voucher and distributes it.
 *
 * **Spread evenly.** Every child who still owes something takes an equal share,
 * capped at their own balance, with anything a capped child could not absorb
 * redistributed over the rest until the money is placed. `spreadEvenly` is the
 * rule and says at length why it is not oldest-first any more.
 *
 * The child challans are what fee reports and the defaulter list read, so this
 * has to reach them — a family payment that only moved the voucher's own
 * `paid_amount` would leave three children reported as defaulters by a system
 * that has their money.
 */
export async function recordFamilyPayment(params: {
  locationId: string;
  actorUid: string;
  familyChallanId: string;
  amount: number;
  paymentMethod: string;
  reference: string | null;
}): Promise<{ distributed: Array<{ challanId: string; amount: string }> }> {
  const { locationId, familyChallanId, amount } = params;

  if (!(amount > 0)) {
    throw new FamilyChallanError('A payment has to be more than zero.');
  }

  const voucherRows = await db
    .select()
    .from(familyChallans)
    .where(
      and(
        eq(familyChallans.locationId, locationId),
        eq(familyChallans.id, familyChallanId),
      ),
    )
    .limit(1);

  const voucher = voucherRows[0];
  if (voucher === undefined) {
    throw new FamilyChallanError('That voucher is not at this school.', 404);
  }

  if (voucher.status === 'cancelled') {
    throw new FamilyChallanError('That voucher has been cancelled.');
  }

  const members = await db
    .select({
      id: feeChallans.id,
      dueDate: feeChallans.dueDate,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
    })
    .from(feeChallans)
    .where(eq(feeChallans.familyChallanId, familyChallanId))
    .orderBy(asc(feeChallans.dueDate), asc(feeChallans.challanNumber));

  const outstandingPaisa = members.reduce(
    (sum, member) =>
      sum +
      Math.max(
        0,
        Math.round(Number(member.totalAmount) * 100) -
          Math.round(Number(member.paidAmount) * 100),
      ),
    0,
  );

  const paymentPaisa = toPaise(amount);
  if (paymentPaisa > outstandingPaisa) {
    throw new FamilyChallanError(
      `That is more than the ${formatPkr(outstandingPaisa / 100)} still owed on this voucher.`,
    );
  }

  const distributed: Array<{ challanId: string; amount: string }> = [];

  const balances = members.map((member) =>
    Math.max(0, toPaise(member.totalAmount) - toPaise(member.paidAmount)),
  );
  const shares = spreadEvenly(balances, paymentPaisa);

  await db.transaction(async (tx) => {
    for (const [index, member] of members.entries()) {
      const applyPaisa = shares[index] ?? 0;
      // A child who owes nothing takes nothing, and gets no `fee_payments` row
      // at all — a receipt for zero is a receipt nobody can explain.
      if (applyPaisa <= 0) continue;

      const owedPaisa = balances[index] ?? 0;
      const applied = paiseToNumeric(applyPaisa);
      const nowPaid = paiseToNumeric(toPaise(member.paidAmount) + applyPaisa);

      await tx.insert(feePayments).values({
        locationId,
        challanId: member.id,
        amount: applied,
        paymentMethod: params.paymentMethod as never,
        referenceNumber: params.reference,
        collectedByUid: params.actorUid,
      });

      await tx
        .update(feeChallans)
        .set({
          paidAmount: nowPaid,
          // Recomputed per child, because an even spread settles some children
          // and part-pays others in the same payment.
          status: applyPaisa >= owedPaisa ? 'paid' : 'partial',
          updatedAt: new Date(),
        })
        .where(eq(feeChallans.id, member.id));

      distributed.push({ challanId: member.id, amount: applied });
    }

    const voucherPaisa = toPaise(voucher.paidAmount) + paymentPaisa;
    const voucherTotalPaisa = toPaise(voucher.totalAmount);

    await tx
      .update(familyChallans)
      .set({
        paidAmount: paiseToNumeric(voucherPaisa),
        status: voucherPaisa >= voucherTotalPaisa ? 'paid' : 'partial',
        updatedAt: new Date(),
      })
      .where(eq(familyChallans.id, familyChallanId));
  });

  return { distributed };
}

/* -----------------------------------------------------------------------------
 * The wizard's three questions (Sprint 18, item 18)
 * -------------------------------------------------------------------------- */

/** One family, with everything open across every month. */
export interface FamilyCandidate {
  guardianId: string;
  guardianName: string;
  phone: string;
  email: string | null;
  /** Distinct children of this family with something open. */
  children: Array<{ studentProfileId: string; studentName: string; studentNumber: string }>;
  /** Months this family has anything open in, newest first. */
  openMonths: Array<{
    billingMonth: number;
    billingYear: number;
    count: number;
    total: string;
  }>;
  /** Everything open, across every month. */
  openTotal: string;
}

/**
 * Families the school could club, found by searching for a person.
 *
 * ── Why this is a search and not a browse ────────────────────────────────
 * Step 1 of the wizard is "find the family", and the way a clerk knows a family
 * is by a name a parent just said at a counter — the father's, or one of the
 * children's. Offering a paginated list of every family in the school is a
 * different screen answering a different question.
 *
 * It matches a **guardian or a child**, by name, admission number or phone,
 * case-insensitively and on any part of the value, and returns only families
 * with more than one child: a single child does not need a family voucher and
 * offering one would put a second number on the same debt for no reason.
 *
 * ── The identity rule is the same one, not a similar one ─────────────────
 * The grouping below is `groupOpenChallans`' union-find, unchanged and shared:
 * two guardian rows are the same person when they share a CNIC **or** a phone
 * number, and transitively so through a third. If this used a looser rule the
 * search would offer a family the generator then refuses to club, and if it
 * used a stricter one the family a school can see on the register would be
 * unfindable here.
 */
export async function searchFamilies(
  locationId: string,
  query: string,
): Promise<FamilyCandidate[]> {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];

  const families = await groupOpenChallans(locationId);

  const matches = families.filter((family) => {
    if (family.children.length < 2) return false;

    const haystack = [
      family.guardianName,
      family.phone,
      // The digits as a clerk says them, so `0321` finds `+923211234567`.
      family.phone.replace(/^\+92/, '0'),
      ...family.children.map((child) => `${child.studentName} ${child.studentNumber}`),
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(needle);
  });

  // Most children first, then the largest total: the family a voucher saves the
  // most queueing for is the one to offer first.
  matches.sort(
    (left, right) =>
      right.children.length - left.children.length ||
      toPaise(right.openTotal) - toPaise(left.openTotal),
  );

  return matches;
}

/**
 * The families this school could club **this month**, best first.
 *
 * The listing above the wizard, and the reason the screen exists: most children
 * first, then largest total. It was buried under a month picker and a table
 * that led with a column of children's names, which is a list of *pupils* where
 * the reader wanted a list of *families*.
 */
export async function listFamilyCandidates(
  locationId: string,
  billingMonth: number,
  billingYear: number,
): Promise<FamilyCandidate[]> {
  const families = await groupOpenChallans(locationId, { billingMonth, billingYear });

  return families
    .filter((family) => family.children.length > 1)
    .sort(
      (left, right) =>
        right.children.length - left.children.length ||
        toPaise(right.openTotal) - toPaise(left.openTotal),
    );
}

/**
 * One family's open vouchers for one month — step 3 of the wizard.
 *
 * Re-read rather than carried down from step 1, for the same reason
 * `createFamilyChallan` re-reads its members: the browser may have been holding
 * a stale list, and clubbing a voucher that has since been paid would demand
 * money twice.
 */
export async function familyOpenVouchers(
  locationId: string,
  guardianId: string,
  billingMonth: number,
  billingYear: number,
): Promise<FamilyMember[]> {
  const families = await groupOpenChallans(locationId, { billingMonth, billingYear });

  const family = families.find((candidate) =>
    candidate.guardianIds.includes(guardianId),
  );

  return family?.members ?? [];
}

export interface FamilyChallanRow {
  id: string;
  challanNumber: string;
  guardianName: string;
  phone: string;
  billingMonth: number | null;
  billingYear: number | null;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  status: string;
  memberCount: number;
  /**
   * The children's own vouchers, so the register can print them.
   *
   * There is no separate print document for a family voucher: what a parent
   * carries to the bank is the slip per child, and the family voucher is the
   * number the payment is recorded against. Printing therefore means printing
   * the members, through the same route the register already uses.
   */
  memberChallanIds: string[];
}

export async function listFamilyChallans(
  locationId: string,
  limit = 50,
): Promise<FamilyChallanRow[]> {
  return db
    .select({
      id: familyChallans.id,
      challanNumber: familyChallans.challanNumber,
      guardianName: studentGuardians.name,
      phone: studentGuardians.phone,
      billingMonth: familyChallans.billingMonth,
      billingYear: familyChallans.billingYear,
      dueDate: familyChallans.dueDate,
      totalAmount: familyChallans.totalAmount,
      paidAmount: familyChallans.paidAmount,
      status: familyChallans.status,
      memberCount: sql<number>`(
        select count(*) from ${feeChallans}
        where ${feeChallans.familyChallanId} = ${familyChallans.id}
      )`.mapWith(Number),
      // An ordered aggregate has no Drizzle operator, which is the only reason
      // this is a raw template; no JavaScript value is interpolated into it.
      memberChallanIds: sql<string[]>`(
        select coalesce(array_agg(m.id order by m.challan_number), '{}')
        from ${feeChallans} m
        where m.family_challan_id = ${familyChallans.id}
      )`,
    })
    .from(familyChallans)
    .innerJoin(studentGuardians, eq(studentGuardians.id, familyChallans.guardianId))
    .where(eq(familyChallans.locationId, locationId))
    .orderBy(desc(familyChallans.createdAt))
    .limit(limit);
}

/**
 * Cancels a voucher, releasing its members back to individual billing.
 *
 * Refused once anything has been paid against it: the payments have already
 * been distributed to the child challans and undoing that means deciding which
 * child's receipt to tear up, which is a counter decision and not a button.
 */
export async function cancelFamilyChallan(
  locationId: string,
  familyChallanId: string,
): Promise<void> {
  const rows = await db
    .select({ paidAmount: familyChallans.paidAmount, status: familyChallans.status })
    .from(familyChallans)
    .where(
      and(
        eq(familyChallans.locationId, locationId),
        eq(familyChallans.id, familyChallanId),
      ),
    )
    .limit(1);

  const voucher = rows[0];
  if (voucher === undefined) {
    throw new FamilyChallanError('That voucher is not at this school.', 404);
  }

  if (Number(voucher.paidAmount) > 0) {
    throw new FamilyChallanError(
      'Money has been paid against this voucher and distributed to the children’s challans. Cancelling it would leave those receipts pointing at nothing.',
      409,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(feeChallans)
      .set({ familyChallanId: null, updatedAt: new Date() })
      .where(eq(feeChallans.familyChallanId, familyChallanId));

    await tx
      .update(familyChallans)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(familyChallans.id, familyChallanId));
  });
}
