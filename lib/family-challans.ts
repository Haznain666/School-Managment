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
import { db } from './drizzle';
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

export interface FamilyGroup {
  guardianId: string;
  guardianName: string;
  phone: string;
  members: FamilyMember[];
  total: string;
}

/**
 * Open challans for one billing period, grouped by guardian phone.
 *
 * Only groups of two or more come back: a single child does not need a family
 * voucher and issuing one would put a second number on the same debt for no
 * reason. Challans already folded into a voucher are excluded, which is what
 * makes a second run for the same month safe.
 */
export async function listFamilyGroups(
  locationId: string,
  billingMonth: number,
  billingYear: number,
): Promise<FamilyGroup[]> {
  const rows = await db
    .select({
      challanId: feeChallans.id,
      studentProfileId: studentProfiles.id,
      studentName: schoolUsers.name,
      studentNumber: studentProfiles.studentId,
      challanNumber: feeChallans.challanNumber,
      dueDate: feeChallans.dueDate,
      totalAmount: feeChallans.totalAmount,
      paidAmount: feeChallans.paidAmount,
      status: feeChallans.status,
      guardianId: studentGuardians.id,
      guardianName: studentGuardians.name,
      phone: studentGuardians.phone,
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
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        eq(feeChallans.billingMonth, billingMonth),
        eq(feeChallans.billingYear, billingYear),
        inArray(feeChallans.status, [...OPEN_CHALLAN_STATUSES]),
        isNull(feeChallans.familyChallanId),
      ),
    )
    .orderBy(asc(studentGuardians.phone), asc(schoolUsers.name));

  /*
   * Union-find over the guardian rows.
   *
   * Each row contributes up to two keys — `phone:+923001234567` and
   * `cnic:42101-1234567-1` — and every key a row carries is merged into one
   * set. Two rows that share *either* key therefore land in the same family,
   * and so do two rows that share nothing directly but are both linked to a
   * third. That transitivity is the whole reason this is a union-find and not
   * a `Map` keyed on "cnic ?? phone": the father whose elder child predates
   * CNIC collection is reachable from his newer record only through the phone
   * number they have in common.
   */
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

  const byFamily = new Map<string, FamilyGroup>();

  for (const row of rows) {
    const key = find(keysFor(row)[0] ?? `phone:${row.phone}`);

    const group = byFamily.get(key) ?? {
      // The first row in the ordering names the voucher. `listFamilyGroups`
      // orders by phone then student name, so the same family is described the
      // same way on every run rather than by whichever child sorted first this
      // month.
      guardianId: row.guardianId,
      guardianName: row.guardianName,
      phone: row.phone,
      members: [],
      total: '0',
    };

    group.members.push({
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

    byFamily.set(key, group);
  }

  return [...byFamily.values()]
    .filter((group) => group.members.length > 1)
    .map((group) => ({
      ...group,
      total: sumMoney(group.members.map((member) => member.totalAmount)),
    }));
}

/** Adds money strings in integer paisa, so a hundred challans do not drift. */
function sumMoney(values: readonly string[]): string {
  const paisa = values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0);
  return (paisa / 100).toFixed(2);
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
    .select({ id: studentGuardians.id })
    .from(studentGuardians)
    .where(
      and(eq(studentGuardians.locationId, locationId), eq(studentGuardians.id, guardianId)),
    )
    .limit(1);

  if (guardianRows[0] === undefined) {
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

  return { id, challanNumber, total, members: members.length };
}

/**
 * Records a payment against a family voucher and distributes it.
 *
 * **Oldest challan first.** A part payment clears the longest-standing debt,
 * which is what a school does by hand and what a parent expects: paying
 * something should retire the oldest slip, not spread a little across all
 * three and leave every child still owing.
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

  let remaining = Math.round(amount * 100);
  if (remaining > outstandingPaisa) {
    throw new FamilyChallanError(
      `That is more than the ${(outstandingPaisa / 100).toFixed(2)} still owed on this voucher.`,
    );
  }

  const distributed: Array<{ challanId: string; amount: string }> = [];

  await db.transaction(async (tx) => {
    for (const member of members) {
      if (remaining <= 0) break;

      const owedPaisa =
        Math.round(Number(member.totalAmount) * 100) -
        Math.round(Number(member.paidAmount) * 100);
      if (owedPaisa <= 0) continue;

      const applyPaisa = Math.min(owedPaisa, remaining);
      remaining -= applyPaisa;

      const applied = (applyPaisa / 100).toFixed(2);
      const nowPaid = (
        (Math.round(Number(member.paidAmount) * 100) + applyPaisa) /
        100
      ).toFixed(2);

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
          status: applyPaisa >= owedPaisa ? 'paid' : 'partial',
          updatedAt: new Date(),
        })
        .where(eq(feeChallans.id, member.id));

      distributed.push({ challanId: member.id, amount: applied });
    }

    const voucherPaisa = Math.round(Number(voucher.paidAmount) * 100) + Math.round(amount * 100);
    const voucherTotalPaisa = Math.round(Number(voucher.totalAmount) * 100);

    await tx
      .update(familyChallans)
      .set({
        paidAmount: (voucherPaisa / 100).toFixed(2),
        status: voucherPaisa >= voucherTotalPaisa ? 'paid' : 'partial',
        updatedAt: new Date(),
      })
      .where(eq(familyChallans.id, familyChallanId));
  });

  return { distributed };
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
