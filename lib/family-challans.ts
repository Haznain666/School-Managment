import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import {
  familyChallans,
  feeChallans,
  feePayments,
  grades,
  ledgerTransactions,
  schoolUsers,
  schools,
  sections,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
  isPaymentMethod,
  OPEN_CHALLAN_STATUSES,
  type FamilyChallanOrigin,
} from '@/db/schema';

import { landingAccountFor, twoSidedLines } from './accounting';
import { schoolUserIdForUid } from './accounting-queries';
import { generateChallanNumber } from './challan-number';
import { formatMonthYear } from './dates';
import { db } from './drizzle';
import { generateChallan } from './fee-challans';
import { defaultDueDate } from './fee-calculator';
import { sendFeeVouchers } from './fee-notices';
import { getDueDay } from './fee-queries';
import {
  cashAccountForStaff,
  loadSystemAccounts,
  postTransaction,
  requireSystemAccount,
  LedgerError,
} from './ledger';
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
  /**
   * How the voucher came to exist. `combined` — the default and everything
   * before Sprint 27 — is one assembled over vouchers the school had already
   * raised. `generated` is set only by `generateFamilyChallan` below, which
   * raised its members itself, and it is what makes cancelling take them with
   * it rather than release them.
   */
  origin?: FamilyChallanOrigin;
}): Promise<{ id: string; challanNumber: string; total: string; members: number }> {
  const { locationId, guardianId, challanIds, dueDate, actorUid } = params;
  const origin = params.origin ?? 'combined';

  if (challanIds.length < 2) {
    throw new FamilyChallanError('A family voucher needs at least two vouchers.');
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
    throw new FamilyChallanError('One of those vouchers is not at this school.', 404);
  }

  const alreadyGrouped = members.find((member) => member.familyChallanId !== null);
  if (alreadyGrouped !== undefined) {
    throw new FamilyChallanError('One of those vouchers is already on a family voucher.');
  }

  const closed = members.find(
    (member) => !(OPEN_CHALLAN_STATUSES as readonly string[]).includes(member.status),
  );
  if (closed !== undefined) {
    throw new FamilyChallanError(
      'One of those vouchers has been paid, cancelled or waived since the list was drawn. Refresh and try again.',
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
      'A family voucher covers one billing month. Those vouchers are from different months.',
    );
  }

  if (first.billingMonth === null || first.billingYear === null) {
    throw new FamilyChallanError(
      'One-off vouchers are not grouped into a family voucher — they have no billing month to share.',
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
      origin,
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

/* -----------------------------------------------------------------------------
 * Raising a family voucher, rather than assembling one (Sprint 27)
 * -------------------------------------------------------------------------- */

/** One enrolled sibling, as the family generator sees them. */
export interface FamilySibling {
  studentProfileId: string;
  studentName: string;
  studentNumber: string;
}

/** A sibling whose month is already spoken for, named on the refusal. */
export interface FamilyMonthClash {
  studentProfileId: string;
  studentName: string;
  challanId: string;
  challanNumber: string;
  /** The family voucher that challan already sits on, when it sits on one. */
  familyChallanNumber: string | null;
  /** Anything received against it. `> 0` means it can never be cancelled. */
  paidAmount: string;
}

/**
 * The month is taken, and here is exactly by whom.
 *
 * A distinct class so the route can put the list in the response body rather
 * than only in the sentence. The screen turns it into *"Cancel these and
 * continue"* — one click, which is what the product owner asked for, instead of
 * the three screens a clerk walks today: find each child, open each voucher,
 * cancel it, come back.
 */
export class FamilyMonthTakenError extends FamilyChallanError {
  readonly clashes: FamilyMonthClash[];

  constructor(clashes: FamilyMonthClash[]) {
    super(
      `${clashes
        .map((clash) => `${clash.studentName} (${clash.challanNumber})`)
        .join(', ')} already ${
        clashes.length === 1 ? 'has a voucher' : 'have vouchers'
      } for this month.`,
      409,
    );
    this.name = 'FamilyMonthTakenError';
    this.clashes = clashes;
  }
}

/**
 * The guardian a family voucher would be addressed to, given any one child.
 *
 * ── Why the screen starts from a pupil and not a parent ──────────────────
 * Every other family surface on this screen searches families that already
 * have *open vouchers*, because clubbing needs vouchers to club. Generation is
 * the opposite case by definition — the month has not been billed — so that
 * search finds nothing, and a feature reachable only from a list it can never
 * appear in is a feature nobody can use.
 *
 * A clerk always knows a child. This resolves the child's **primary contact**,
 * which is the row `groupOpenChallans` groups on and the person the school
 * writes to, and everything else follows from there.
 */
export async function primaryGuardianFor(
  locationId: string,
  studentProfileId: string,
): Promise<{ id: string; name: string; phone: string } | null> {
  const rows = await db
    .select({
      id: studentGuardians.id,
      name: studentGuardians.name,
      phone: studentGuardians.phone,
    })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.studentProfileId, studentProfileId),
        eq(studentGuardians.isPrimaryContact, true),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The children of one guardian who are actually on the roll for a given year.
 *
 * ── Why this is not `listSiblings` ───────────────────────────────────────
 * `lib/siblings.ts` answers "who else is in this family", against the school's
 * **active** year, and it deliberately includes children who have left — an
 * admin looking at a withdrawn elder brother is looking at the reason the
 * younger one has a discount. Neither is right here: a voucher is raised for a
 * named academic year, and billing a child who withdrew in June for October
 * would be a demand the school cannot defend.
 *
 * So the matching rule is borrowed — same CNIC or same phone, canonicalised —
 * and the placement is an INNER join through the year being billed.
 */
export async function enrolledSiblingsFor(
  locationId: string,
  guardianId: string,
  academicYearId: string,
): Promise<FamilySibling[]> {
  const guardianRows = await db
    .select({ cnic: studentGuardians.cnic, phone: studentGuardians.phone })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.id, guardianId),
      ),
    )
    .limit(1);

  const guardian = guardianRows[0];
  if (guardian === undefined) return [];

  // Only a whole, canonical CNIC is a key — the same rule `groupOpenChallans`
  // above states at length. A half-recorded number matching another
  // half-recorded number would invent a family and then bill it as one.
  const cnic = normalizeCnic(guardian.cnic);
  const matchers = [
    ...(cnic === null
      ? []
      : [and(isNotNull(studentGuardians.cnic), eq(studentGuardians.cnic, cnic))]),
    ...(guardian.phone === '' ? [] : [eq(studentGuardians.phone, guardian.phone)]),
  ];

  if (matchers.length === 0) return [];

  return db
    .selectDistinctOn([schoolUsers.name, studentProfiles.id], {
      studentProfileId: studentProfiles.id,
      studentName: schoolUsers.name,
      studentNumber: studentProfiles.studentId,
    })
    .from(studentGuardians)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, studentProfiles.id),
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.academicYearId, academicYearId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .where(and(eq(studentGuardians.locationId, locationId), or(...matchers)))
    .orderBy(asc(schoolUsers.name), asc(studentProfiles.id));
}

/**
 * Live vouchers these children already hold for a month, with their wrapper.
 *
 * Exported because the *dialog* needs it before the POST does: the screen asks
 * what would happen, draws the children by name and voucher number, and offers
 * to cancel them. The generator re-runs the same read a moment later and
 * refuses on what it finds then — the browser's list is a courtesy, never the
 * input, which is the same discipline `createFamilyChallan` applies to its
 * member list.
 */
export async function monthClashesForGuardian(
  locationId: string,
  academicYearId: string,
  studentProfileIds: readonly string[],
  billingMonth: number,
  billingYear: number,
): Promise<FamilyMonthClash[]> {
  return db
    .select({
      studentProfileId: feeChallans.studentProfileId,
      studentName: schoolUsers.name,
      challanId: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      familyChallanNumber: familyChallans.challanNumber,
      paidAmount: feeChallans.paidAmount,
    })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .leftJoin(familyChallans, eq(familyChallans.id, feeChallans.familyChallanId))
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        eq(feeChallans.academicYearId, academicYearId),
        eq(feeChallans.billingMonth, billingMonth),
        eq(feeChallans.billingYear, billingYear),
        // The same predicate the partial unique index carries, so that what
        // this read calls "taken" is exactly what Postgres would refuse.
        ne(feeChallans.status, 'cancelled'),
        inArray(feeChallans.studentProfileId, [...studentProfileIds]),
      ),
    )
    .orderBy(asc(schoolUsers.name));
}

export interface GenerateFamilyChallanParams {
  locationId: string;
  actorUid: string;
  guardianId: string;
  academicYearId: string;
  billingMonth: number;
  billingYear: number;
  dueDate?: string | undefined;
  /**
   * Cancel the siblings' existing vouchers for the month and carry on.
   *
   * Off by default and always an explicit second request: the first one
   * refuses with the children named, the screen shows them, and a person
   * decides. A generator that cancelled by default would tear up vouchers a
   * parent may already be holding.
   */
  cancelExisting?: boolean | undefined;
}

export interface GeneratedFamilyChallan {
  id: string;
  challanNumber: string;
  total: string;
  members: number;
  /** Vouchers cancelled to make room, when `cancelExisting` was asked for. */
  cancelled: string[];
}

/**
 * Raises the month's voucher for every enrolled sibling **and** the wrapper.
 *
 * ── Why this exists beside `createFamilyChallan` ─────────────────────────
 * `createFamilyChallan` clubs vouchers that already exist, which is the right
 * tool once the month has been billed. It is the wrong one for the thing a
 * school actually wants to do on the 25th: raise October for the Rehmans, as
 * one slip, in one action. Doing that today means running the bulk generator,
 * finding the three children in a register of four hundred, and clubbing them.
 *
 * ── Same pricing, same numbering, same everything ────────────────────────
 * Each child's voucher goes through `generateChallan`, unchanged and
 * unbranched: the same concessions, the same carried-forward credit, the same
 * discount-overflow banking and the same number issuer. A second pricing path
 * for family billing is how two children in one family come to be charged
 * differently for the same class, with nothing on any screen saying why.
 *
 * ── One action, and the honest limit of that claim ───────────────────────
 * `generateChallan` opens its own transaction per child — that is what makes a
 * bulk run of four hundred survive one child's bad data — so this is *n + 1*
 * transactions and not one. What closes the gap is the compensation at the
 * bottom: if the wrapper cannot be written, the vouchers this call just raised
 * are cancelled again. They are seconds old, unpaid and unseen, so cancelling
 * them is exact rather than approximate, and the alternative — three vouchers
 * nobody asked for left in the register — is the outcome worth avoiding.
 */
export async function generateFamilyChallan(
  params: GenerateFamilyChallanParams,
): Promise<GeneratedFamilyChallan> {
  const { locationId, guardianId, academicYearId, billingMonth, billingYear } = params;

  const siblings = await enrolledSiblingsFor(locationId, guardianId, academicYearId);

  if (siblings.length < 2) {
    throw new FamilyChallanError(
      siblings.length === 0
        ? 'That guardian has no children enrolled in this academic year.'
        : 'A family voucher needs at least two children enrolled here. This guardian has one.',
    );
  }

  const clashes = await monthClashesForGuardian(
    locationId,
    academicYearId,
    siblings.map((sibling) => sibling.studentProfileId),
    billingMonth,
    billingYear,
  );

  const cancelled: string[] = [];

  if (clashes.length > 0) {
    if (params.cancelExisting !== true) throw new FamilyMonthTakenError(clashes);

    // A voucher carrying money is never cancelled, whatever was asked for. A
    // cancelled voucher with a receipt against it is a receipt pointing at
    // nothing, and no amount of confirming on a screen makes that acceptable.
    const paid = clashes.filter((clash) => Number(clash.paidAmount) > 0);
    if (paid.length > 0) {
      const names = paid
        .map((clash) => `${clash.studentName} (${clash.challanNumber})`)
        .join(', ');

      throw new FamilyChallanError(
        `${names} ${paid.length === 1 ? 'has' : 'have'} already paid something towards this month, so ${paid.length === 1 ? 'that voucher' : 'those vouchers'} cannot be cancelled. Settle the month for ${paid.length === 1 ? 'that child' : 'those children'} separately.`,
        409,
      );
    }

    const wrapperIds = [
      ...new Set(
        clashes
          .filter((clash) => clash.familyChallanNumber !== null)
          .map((clash) => clash.familyChallanNumber ?? ''),
      ),
    ];

    await db.transaction(async (tx) => {
      await tx
        .update(feeChallans)
        .set({ status: 'cancelled', familyChallanId: null, updatedAt: new Date() })
        .where(
          and(
            eq(feeChallans.locationId, locationId),
            inArray(
              feeChallans.id,
              clashes.map((clash) => clash.challanId),
            ),
          ),
        );

      /*
       * A wrapper left holding nothing but cancelled members is cancelled too.
       *
       * Without this, re-clubbing a family that was already clubbed leaves the
       * old voucher live and unpaid beside the new one — two numbers for one
       * month, which is exactly what `family_challans_guardian_month_idx`
       * refuses a moment later, with a duplicate-key error naming an index
       * instead of anything a clerk can act on.
       */
      if (wrapperIds.length > 0) {
        await tx
          .update(familyChallans)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(
            and(
              eq(familyChallans.locationId, locationId),
              inArray(familyChallans.challanNumber, wrapperIds),
            ),
          );
      }
    });

    cancelled.push(...clashes.map((clash) => clash.challanNumber));
  }

  const dueDate =
    params.dueDate ??
    defaultDueDate(billingMonth, billingYear, await getDueDay(locationId));

  const raised: string[] = [];

  try {
    for (const sibling of siblings) {
      const challan = await generateChallan(db, {
        locationId,
        studentProfileId: sibling.studentProfileId,
        academicYearId,
        billingMonth,
        billingYear,
        dueDate,
        actorUid: params.actorUid,
        // The wrapper sends one email naming every child. Letting each child's
        // own voucher mail as well would put four slips in the same inbox,
        // which is the opposite of what a family voucher is for.
        suppressVoucherEmail: true,
      });

      raised.push(challan.id);
    }

    const created = await createFamilyChallan({
      locationId,
      actorUid: params.actorUid,
      guardianId,
      challanIds: raised,
      dueDate,
      origin: 'generated',
    });

    return { ...created, cancelled };
  } catch (error) {
    // The compensation the docblock promises. Cancelled rather than deleted,
    // because `fee_challans` is a billing record and the numbers it burnt are
    // burnt either way — and because cancelling is the one operation the
    // partial unique index treats as making the month free again.
    if (raised.length > 0) {
      try {
        await db
          .update(feeChallans)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(
            and(eq(feeChallans.locationId, locationId), inArray(feeChallans.id, raised)),
          );
      } catch (rollback) {
        console.error(
          `[family-challans] could not roll back ${String(raised.length)} voucher(s) at ${locationId}:`,
          rollback,
        );
      }
    }

    throw error;
  }
}

/**
 * The two accounts a family fee payment moves between, or null if there are none.
 *
 * The same decision `…/challans/[challanId]/payments/route.ts` makes for a
 * single voucher, taken here rather than imported because the route's copy is a
 * private function on a route module. What matters is that the *rule* is the
 * same one: money lands where it actually went — the clerk's own drawer for
 * cash, `1020 Cheques in Hand` for a cheque, the bank for a transfer — and Fee
 * Income is credited.
 *
 * Returns null rather than throwing when the school has no chart of accounts. A
 * parent is standing at a counter with cash; refusing it because the books are
 * unset would be the wrong trade, and the response says the posting did not
 * happen.
 */
async function resolveFamilyPosting(input: {
  locationId: string;
  collector: string | null;
  paymentMethod: 'cash' | 'bank_transfer' | 'cheque';
}): Promise<{ landingAccountId: string; incomeAccountId: string } | null> {
  try {
    const systemAccounts = await loadSystemAccounts(input.locationId);
    const income = requireSystemAccount(systemAccounts, 'fee_income', 'Fee Income');
    const landingKey = landingAccountFor(input.paymentMethod);
    const landing = requireSystemAccount(
      systemAccounts,
      landingKey,
      landingKey === 'bank'
        ? 'Bank Account'
        : landingKey === 'cheques_in_hand'
          ? 'Cheques in Hand'
          : 'Cash in Hand',
    );

    // Only cash sits in a person's drawer. A transfer is already at the bank
    // and a cheque is paper the office files, so neither belongs to whoever
    // happened to key it in.
    const account =
      landingKey === 'cash_in_hand'
        ? await cashAccountForStaff(input.locationId, input.collector, landing)
        : landing;

    return { landingAccountId: account.id, incomeAccountId: income.id };
  } catch (error) {
    if (error instanceof LedgerError) {
      console.warn('[family-challans] payment not posted to the ledger:', error.message);
      return null;
    }
    throw error;
  }
}

/**
 * Records a payment against a family voucher, distributes it, and posts it.
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
 *
 * ── The posting, added in Sprint 27, and what was wrong before it ────────
 * 🔴 This function wrote `fee_payments` rows and moved balances and **posted
 * nothing to the ledger**, from Sprint 10 until now. The single-voucher route
 * beside it has posted since Sprint 13.5; the family path never did. So every
 * family payment any school has ever taken understated its income, and
 * understated it in the way CLAUDE.md warns about — silently. Nothing on any
 * screen would have said so: the receipt printed, the children showed as paid,
 * the defaulter list emptied, and only the trial balance disagreed with the
 * cash box.
 *
 * ── One posting, not one per child ───────────────────────────────────────
 * The money arrived once, across one counter, in one transaction. Posting it
 * per child would put three entries in the day book for one event and make
 * reconciling a day's takings against the ledger a matching exercise rather
 * than a comparison. The per-child detail lives in `fee_payments`, which is
 * where a parent's question — *"what did you put against Ali?"* — is answered,
 * and every one of those rows carries `ledger_transaction_id` so each child's
 * receipt names the posting that carries it.
 *
 * ── Inside the transaction, not beside it ────────────────────────────────
 * CLAUDE.md: *taking money in code — post it in the same transaction as the
 * record of it.* The posting commits with the payment or the payment does not
 * happen. The one exception is a school with no chart of accounts, which
 * records the payment un-posted and says so, exactly as the single route does:
 * a counter must not stop because the books are unset.
 */
export async function recordFamilyPayment(params: {
  locationId: string;
  actorUid: string;
  familyChallanId: string;
  amount: number;
  paymentMethod: string;
  reference: string | null;
}): Promise<{
  distributed: Array<{ challanId: string; amount: string }>;
  /**
   * Null only at a school with no chart of accounts. The receipt screen says
   * so rather than staying quiet: a payment that did not reach the books is a
   * reconciliation problem, and the person who can fix it is the one standing
   * at the counter.
   */
  ledgerTransactionId: string | null;
}> {
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

  const guardianRows = await db
    .select({ name: studentGuardians.name })
    .from(studentGuardians)
    .where(eq(studentGuardians.id, voucher.guardianId))
    .limit(1);

  /*
   * The campus this money was taken at, or null when the family straddles two.
   *
   * A family is a family across campuses — `lib/siblings.ts` says so at length
   * and `check-branch-scope` asserts it — so a family voucher genuinely can
   * cover children at two of them. There is no honest single answer in that
   * case, and inventing one would attribute a campus's income to its neighbour
   * on the owner's dashboard, which is the exact defect Sprint 19a fixed for
   * the single-voucher route. Null is the truthful value: school-wide.
   */
  const campuses = await db
    .selectDistinct({ branchId: grades.branchId })
    .from(feeChallans)
    .innerJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, feeChallans.studentProfileId),
        eq(studentEnrollments.academicYearId, feeChallans.academicYearId),
        eq(studentEnrollments.locationId, locationId),
      ),
    )
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(eq(feeChallans.familyChallanId, familyChallanId));

  const postingBranchId = campuses.length === 1 ? (campuses[0]?.branchId ?? null) : null;

  // Resolved before the transaction opens: indexed reads that do not need to
  // be inside it, and keeping them out shortens the window the rows are held.
  const collector = await schoolUserIdForUid(locationId, params.actorUid);
  /*
   * `paymentMethod` reaches this function as a plain string — the route
   * validates it and the column has a CHECK — so it is narrowed here rather
   * than cast. An unrecognised method posts nothing instead of guessing which
   * account the money landed in, and guessing is the one thing a ledger must
   * never do.
   */
  const posting = isPaymentMethod(params.paymentMethod)
    ? await resolveFamilyPosting({
        locationId,
        collector,
        paymentMethod: params.paymentMethod,
      })
    : null;

  const paymentDate = new Date().toISOString().slice(0, 10);

  const ledgerTransactionId = await db.transaction(async (tx) => {
    /*
     * The posting is written **first**, so that every `fee_payments` row this
     * transaction inserts can carry its id. One transaction for the whole
     * family payment: the money arrived once.
     *
     * Built on `tx`, like everything else here. A statement built on `db` runs
     * outside the transaction even when awaited inside one — `lib/drizzle.ts`
     * says so — and a posting that committed separately from the payments it
     * describes is worse than the missing posting this replaces.
     */
    const transactionId =
      posting === null
        ? null
        : await postTransaction(tx, {
            locationId,
            branchId: postingBranchId,
            entryDate: paymentDate,
            memo: `Fee received — ${guardianRows[0]?.name ?? 'family'} (${voucher.challanNumber})`,
            source: 'fee_payment',
            referenceNumber: params.reference,
            createdByUid: params.actorUid,
            lines: twoSidedLines(
              posting.landingAccountId,
              posting.incomeAccountId,
              paymentPaisa,
            ),
          });

    let firstPaymentId: string | null = null;

    for (const [index, member] of members.entries()) {
      const applyPaisa = shares[index] ?? 0;
      // A child who owes nothing takes nothing, and gets no `fee_payments` row
      // at all — a receipt for zero is a receipt nobody can explain.
      if (applyPaisa <= 0) continue;

      const owedPaisa = balances[index] ?? 0;
      const applied = paiseToNumeric(applyPaisa);
      const nowPaid = paiseToNumeric(toPaise(member.paidAmount) + applyPaisa);

      const [payment] = await tx
        .insert(feePayments)
        .values({
          locationId,
          challanId: member.id,
          amount: applied,
          paymentMethod: params.paymentMethod as never,
          referenceNumber: params.reference,
          paymentDate,
          collectedByUid: params.actorUid,
          // Every child's row, not just the first. Each receipt names the
          // posting that carries it, and they all name the same one.
          ledgerTransactionId: transactionId,
        })
        .returning({ id: feePayments.id });

      firstPaymentId ??= payment?.id ?? null;

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

    // `source_id` points at the first child's payment row, as the
    // single-voucher route points at its only one. It is what the day book's
    // "what caused this" link resolves, and what stops the `0027` backfill
    // touching a payment that already has a posting.
    if (transactionId !== null && firstPaymentId !== null) {
      await tx
        .update(ledgerTransactions)
        .set({ sourceId: firstPaymentId })
        .where(eq(ledgerTransactions.id, transactionId));
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

    return transactionId;
  });

  return { distributed, ledgerTransactionId };
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

/** What cancelling a family voucher did to its members. */
export interface FamilyCancellation {
  origin: FamilyChallanOrigin;
  /** Members returned to being billed individually, by voucher number. */
  released: string[];
  /** Members cancelled along with the wrapper, by voucher number. */
  cancelled: string[];
}

/**
 * Cancels a voucher and does the right thing with its members.
 *
 * ── Cancelling follows origin, and it has to ─────────────────────────────
 * A `combined` voucher was assembled over vouchers the school had already
 * raised. Those vouchers are still what the school intends to collect, so
 * cancelling the wrapper **releases** them: `family_challan_id` back to null,
 * each child billed individually again. That is what this function has always
 * done and it stays right.
 *
 * A `generated` voucher raised its members itself. They exist only because it
 * does, and releasing them would leave three vouchers nobody asked for, in a
 * month a school has just decided not to bill that way — invisible on the
 * family screen, present on the defaulter list. So they are **cancelled with
 * it**, in one transaction.
 *
 * ── A member carrying money is released, never cancelled ─────────────────
 * Whatever the origin. A cancelled voucher with a receipt against it is a
 * receipt pointing at nothing, and there is no flow that makes that acceptable
 * — so a paid or part-paid member is set loose to stand on its own and the
 * caller is told which ones, by number, so the school can see what it is left
 * holding.
 *
 * The wrapper itself is still refused once anything has been paid *against the
 * wrapper*: those payments have already been distributed to the children, and
 * undoing that means deciding whose receipt to tear up, which is a counter
 * decision and not a button.
 */
export async function cancelFamilyChallan(
  locationId: string,
  familyChallanId: string,
): Promise<FamilyCancellation> {
  const rows = await db
    .select({
      paidAmount: familyChallans.paidAmount,
      status: familyChallans.status,
      origin: familyChallans.origin,
    })
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
      'Money has been paid against this voucher and distributed to the children’s vouchers. Cancelling it would leave those receipts pointing at nothing.',
      409,
    );
  }

  const members = await db
    .select({
      id: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      paidAmount: feeChallans.paidAmount,
    })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        eq(feeChallans.familyChallanId, familyChallanId),
      ),
    )
    .orderBy(asc(feeChallans.challanNumber));

  const takesTheMembers = voucher.origin === 'generated';

  const toCancel = takesTheMembers
    ? members.filter((member) => Number(member.paidAmount) <= 0)
    : [];
  const toRelease = members.filter((member) => !toCancel.includes(member));

  await db.transaction(async (tx) => {
    if (toRelease.length > 0) {
      await tx
        .update(feeChallans)
        .set({ familyChallanId: null, updatedAt: new Date() })
        .where(
          inArray(
            feeChallans.id,
            toRelease.map((member) => member.id),
          ),
        );
    }

    if (toCancel.length > 0) {
      await tx
        .update(feeChallans)
        .set({ status: 'cancelled', familyChallanId: null, updatedAt: new Date() })
        .where(
          inArray(
            feeChallans.id,
            toCancel.map((member) => member.id),
          ),
        );
    }

    await tx
      .update(familyChallans)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(familyChallans.id, familyChallanId));
  });

  return {
    origin: voucher.origin,
    released: toRelease.map((member) => member.challanNumber),
    cancelled: toCancel.map((member) => member.challanNumber),
  };
}
