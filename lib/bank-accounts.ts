import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  bankAccounts,
  branches,
  VOUCHER_BANK_PURPOSES,
  type BankPurpose,
} from '@/db/schema';

import { sharedOrOwnedBy } from './branch-scope';
import { db } from './drizzle';

/**
 * The accounts a school prints on a fee voucher and pays its salaries from
 * (Sprint 20, item 10).
 *
 * ── Whose data this is ───────────────────────────────────────────────────
 * School-wide reference data read by **two** modules and owned by neither: Fees
 * prints the student-facing accounts on a voucher, Payroll pays out of the
 * staff-facing ones. That is decision D2, and it is why the screen lives at
 * `/dashboard/settings/banks` on `settings.read` / `settings.write` rather than
 * under Fees — filing it under Fees would put the payroll bank under Fees,
 * which is where nobody would look for it.
 *
 * ── `branch_id` is nullable and null means shared ────────────────────────
 * Decision D1 of Sprint 19a, one table on. `sharedOrOwnedBy` is the predicate
 * and **`eq` is the defect**: every row is shared on the day this ships, and
 * `eq(bankAccounts.branchId, campus)` would return nothing at all — a voucher
 * with no bank block, which reads as a school that has not set one up.
 *
 * ── Nothing here is money ────────────────────────────────────────────────
 * An account *number* is not a balance. The ledger's cash and bank accounts are
 * `ledger_accounts` rows with an entirely separate job; this table holds the
 * digits a parent types into their banking app, and no code path here posts
 * anything. See `db/schema/bank-accounts.ts`.
 */

export interface BankAccountRow {
  id: string;
  branchId: string | null;
  branchName: string | null;
  accountTitle: string;
  bankName: string;
  branchNameOfBank: string | null;
  branchCode: string | null;
  accountNumber: string;
  iban: string | null;
  swiftCode: string | null;
  bankAddress: string | null;
  intermediaryBank: string | null;
  intermediarySwift: string | null;
  currency: string;
  purpose: BankPurpose;
  instructions: string | null;
  isActive: boolean;
  sortOrder: number;
}

export class BankAccountError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'BankAccountError';
    this.code = code;
    this.status = status;
  }
}

/**
 * The columns every read here selects.
 *
 * `branchNameOfBank` is `bank_accounts.branch_name` — the *bank's* branch — and
 * `branchName` is `branches.name`, the *school's* campus. Two different things
 * one word apart, which is exactly why the TypeScript names differ: reading
 * `branchName` on a row and getting "Gulberg Branch" when the campus was meant
 * is the kind of mistake that reaches a printed voucher.
 */
const BANK_COLUMNS = {
  id: bankAccounts.id,
  branchId: bankAccounts.branchId,
  branchName: branches.name,
  accountTitle: bankAccounts.accountTitle,
  bankName: bankAccounts.bankName,
  branchNameOfBank: bankAccounts.branchName,
  branchCode: bankAccounts.branchCode,
  accountNumber: bankAccounts.accountNumber,
  iban: bankAccounts.iban,
  swiftCode: bankAccounts.swiftCode,
  bankAddress: bankAccounts.bankAddress,
  intermediaryBank: bankAccounts.intermediaryBank,
  intermediarySwift: bankAccounts.intermediarySwift,
  currency: bankAccounts.currency,
  purpose: bankAccounts.purpose,
  instructions: bankAccounts.instructions,
  isActive: bankAccounts.isActive,
  sortOrder: bankAccounts.sortOrder,
} as const;

/**
 * Every account this caller may see — active and inactive both.
 *
 * The settings screen shows the switched-off ones deliberately: the toggle is
 * the safe alternative to deleting, and an account that disappeared when it was
 * switched off would make the toggle indistinguishable from a delete.
 */
export async function listBankAccounts(
  locationId: string,
  branchIds: string[] | null = null,
): Promise<BankAccountRow[]> {
  return db
    .select(BANK_COLUMNS)
    .from(bankAccounts)
    .leftJoin(branches, eq(branches.id, bankAccounts.branchId))
    .where(
      and(
        eq(bankAccounts.locationId, locationId),
        // Shared accounts plus this campus's own. Never `eq` — see the
        // module docblock and `lib/branch-scope.ts`.
        sharedOrOwnedBy(bankAccounts.branchId, branchIds),
      ),
    )
    .orderBy(
      asc(bankAccounts.sortOrder),
      asc(bankAccounts.bankName),
      asc(bankAccounts.accountTitle),
    );
}

/**
 * The accounts that print on one voucher.
 *
 * Three conditions and every one of them matters:
 *
 *   · **active only** — that is the whole point of the toggle. A school closing
 *     an account needs the number off tomorrow's vouchers without losing the
 *     record of where last month's money went;
 *   · **student-facing only** — the payroll account is not something a parent
 *     should be paying into, and printing it is how a fee lands in the salary
 *     account and reconciles against nothing;
 *   · **this campus, or shared** — `sharedOrOwnedBy`, so a campus-owned account
 *     prints on that campus's vouchers and a null one prints on all of them.
 *
 * Ordered by `sort_order` then bank name, so a school decides which account a
 * parent reads first — usually the one its own staff can chase a transfer
 * through.
 */
export async function listVoucherBankAccounts(
  locationId: string,
  branchId: string | null,
): Promise<BankAccountRow[]> {
  return db
    .select(BANK_COLUMNS)
    .from(bankAccounts)
    .leftJoin(branches, eq(branches.id, bankAccounts.branchId))
    .where(
      and(
        eq(bankAccounts.locationId, locationId),
        eq(bankAccounts.isActive, true),
        inArray(bankAccounts.purpose, [...VOUCHER_BANK_PURPOSES]),
        /*
         * `branchId === null` means the voucher's own campus could not be
         * resolved — a student with no placement, a grade with no campus — and
         * the honest answer then is the school's shared accounts only. Passing
         * `null` through to `sharedOrOwnedBy` would mean "every campus", which
         * would print another campus's account on this slip.
         */
        sharedOrOwnedBy(bankAccounts.branchId, branchId === null ? [] : [branchId]),
      ),
    )
    .orderBy(
      asc(bankAccounts.sortOrder),
      asc(bankAccounts.bankName),
      asc(bankAccounts.accountTitle),
    );
}

export interface BankAccountInput {
  branchId: string | null;
  accountTitle: string;
  bankName: string;
  branchNameOfBank: string | null;
  branchCode: string | null;
  accountNumber: string;
  iban: string | null;
  swiftCode: string | null;
  bankAddress: string | null;
  intermediaryBank: string | null;
  intermediarySwift: string | null;
  currency: string;
  purpose: BankPurpose;
  instructions: string | null;
  isActive: boolean;
  sortOrder: number;
}

/** The values both writes share, mapped from the input to the columns. */
function valuesFrom(input: BankAccountInput) {
  return {
    branchId: input.branchId,
    accountTitle: input.accountTitle,
    bankName: input.bankName,
    branchName: input.branchNameOfBank,
    branchCode: input.branchCode,
    accountNumber: input.accountNumber,
    iban: input.iban,
    swiftCode: input.swiftCode,
    bankAddress: input.bankAddress,
    intermediaryBank: input.intermediaryBank,
    intermediarySwift: input.intermediarySwift,
    currency: input.currency,
    purpose: input.purpose,
    instructions: input.instructions,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
  };
}

export async function createBankAccount(
  locationId: string,
  input: BankAccountInput,
): Promise<string> {
  const rows = await db
    .insert(bankAccounts)
    .values({ locationId, ...valuesFrom(input) })
    .returning({ id: bankAccounts.id });

  return rows[0]!.id;
}

export async function updateBankAccount(
  locationId: string,
  bankAccountId: string,
  input: BankAccountInput,
): Promise<void> {
  const updated = await db
    .update(bankAccounts)
    .set({ ...valuesFrom(input), updatedAt: new Date() })
    // Tenant-scoped, so an id from another school updates nothing and is
    // reported as not found rather than acted on.
    .where(
      and(
        eq(bankAccounts.id, bankAccountId),
        eq(bankAccounts.locationId, locationId),
      ),
    )
    .returning({ id: bankAccounts.id });

  if (updated[0] === undefined) {
    throw new BankAccountError('not_found', 'That account is not at this school.', 404);
  }
}

/**
 * Switches one account on or off, without touching anything else.
 *
 * Its own function rather than a full update, because the row toggle sends one
 * field and a full-record write from a table row would silently overwrite
 * whatever somebody else had just edited in the modal.
 */
export async function setBankAccountActive(
  locationId: string,
  bankAccountId: string,
  isActive: boolean,
): Promise<void> {
  const updated = await db
    .update(bankAccounts)
    .set({ isActive, updatedAt: new Date() })
    .where(
      and(
        eq(bankAccounts.id, bankAccountId),
        eq(bankAccounts.locationId, locationId),
      ),
    )
    .returning({ id: bankAccounts.id });

  if (updated[0] === undefined) {
    throw new BankAccountError('not_found', 'That account is not at this school.', 404);
  }
}

/**
 * Deletes an account.
 *
 * ── The rule that could not be enforced, stated plainly ──────────────────
 * The obvious safeguard is to refuse a delete once the account has been printed
 * on a voucher. Nothing records that: a voucher is rendered from this table at
 * print time and snapshots none of it. So the delete is allowed, the
 * confirmation says in words that vouchers already printed carry these details
 * and will not change, and the screen points at the toggle as the safer act.
 *
 * Deactivating is what a school closing an account actually wants — the number
 * comes off tomorrow's vouchers and the record of where last month's money went
 * survives.
 */
export async function deleteBankAccount(
  locationId: string,
  bankAccountId: string,
): Promise<void> {
  const deleted = await db
    .delete(bankAccounts)
    .where(
      and(
        eq(bankAccounts.id, bankAccountId),
        eq(bankAccounts.locationId, locationId),
      ),
    )
    .returning({ id: bankAccounts.id });

  if (deleted[0] === undefined) {
    throw new BankAccountError('not_found', 'That account is not at this school.', 404);
  }
}
