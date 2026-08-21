import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import {
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  type LedgerAccount,
} from '@/db/schema';

import {
  LINE_PROBLEM_MESSAGES,
  lineProblem,
  mirrorLines,
  type LedgerLineInput,
  type LedgerSource,
  type SystemAccountKey,
} from './accounting';
import { db, type Database, type Tx } from './drizzle';
import { paiseToNumeric, toPaise } from './money';

/**
 * The only way anything is written to the ledger.
 *
 * ── One door ─────────────────────────────────────────────────────────────
 * Every posting in this product goes through `postTransaction`: fee payments,
 * expenses, settlements, hand-written journal entries, and whatever Sprints 16
 * and 20 bring. That is what makes the balance check below true of the whole
 * book rather than of the code paths somebody remembered to check.
 *
 * Nothing here updates or deletes. `reverseTransaction` is the correction, and
 * it writes a new transaction rather than touching the old one.
 *
 * ── Every function takes a `Tx` ──────────────────────────────────────────
 * Not a convenience. A fee payment's posting must commit with the payment or
 * not at all: a payment recorded without its posting understates income
 * silently, and a posting written without its payment credits the school with
 * money nobody received. Both callers already open a transaction for their own
 * writes, and these join it.
 *
 * `postTransactionStandalone` exists for the callers that have nothing else to
 * write, and it opens its own.
 */

export interface PostTransactionInput {
  locationId: string;
  branchId?: string | null;
  /** The day the school considers this to have happened — `YYYY-MM-DD`. */
  entryDate: string;
  memo: string;
  source: LedgerSource;
  sourceId?: string | null;
  referenceNumber?: string | null;
  createdByUid: string;
  lines: readonly LedgerLineInput[];
  /** Set only by `reverseTransaction`. */
  reversesTransactionId?: string | null;
}

/**
 * Thrown when a posting is refused. Carries a sentence fit to show a person.
 *
 * A distinct class rather than a plain `Error` so a route can tell "these
 * lines do not balance", which is a 400, from a driver failure, which is a
 * 500. `handleApiError` sees the second and nothing else.
 */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Writes one balanced transaction and returns its id.
 *
 * The balance check is `lineProblem` from `lib/accounting.ts` — the same
 * function the expense form runs in the browser and the check script asserts
 * against — and it runs here, on the server, before a row is written. An
 * unbalanced set of lines throws; there is no path that stores one.
 */
export async function postTransaction(
  tx: Tx,
  input: PostTransactionInput,
): Promise<string> {
  const problem = lineProblem(input.lines);
  if (problem !== null) throw new LedgerError(LINE_PROBLEM_MESSAGES[problem]);

  // Every account must belong to this school. The ids reach here from a
  // request body on the journal-entry and expense routes, so this is the
  // tenancy check for the module — without it, a crafted body could post a
  // credit into another school's income.
  await assertAccountsBelongToSchool(
    tx,
    input.locationId,
    input.lines.map((line) => line.accountId),
  );

  const [transaction] = await tx
    .insert(ledgerTransactions)
    .values({
      locationId: input.locationId,
      branchId: input.branchId ?? null,
      entryDate: input.entryDate,
      memo: input.memo,
      source: input.source,
      sourceId: input.sourceId ?? null,
      referenceNumber: input.referenceNumber ?? null,
      reversesTransactionId: input.reversesTransactionId ?? null,
      createdByUid: input.createdByUid,
    })
    .returning({ id: ledgerTransactions.id });

  if (transaction === undefined) {
    throw new LedgerError('The ledger entry could not be written.');
  }

  await tx.insert(ledgerEntries).values(
    input.lines.map((line) => ({
      locationId: input.locationId,
      transactionId: transaction.id,
      accountId: line.accountId,
      debit: paiseToNumeric(line.debitPaise),
      credit: paiseToNumeric(line.creditPaise),
      memo: line.memo ?? null,
    })),
  );

  return transaction.id;
}

/** `postTransaction` for a caller with nothing else to write. */
export async function postTransactionStandalone(
  input: PostTransactionInput,
  database: Database = db,
): Promise<string> {
  return database.transaction(async (tx) => postTransaction(tx, input));
}

/**
 * Refuses ids that are not this school's, naming the count rather than the id.
 *
 * A distinct account exists at another school and the ordinary "not found"
 * would be true, but "3 of the accounts on this entry are not yours" is not a
 * message anybody should be able to elicit — so the sentence is the same one a
 * mistyped id gets.
 */
async function assertAccountsBelongToSchool(
  tx: Tx,
  locationId: string,
  accountIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(accountIds)];

  const found = await tx
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.locationId, locationId),
        inArray(ledgerAccounts.id, unique),
      ),
    );

  if (found.length !== unique.length) {
    throw new LedgerError('One of the accounts on this entry could not be found.');
  }
}

/**
 * Reverses a transaction: a new one, mirrored, on the day it is corrected.
 *
 * ── Two things it deliberately does not do ───────────────────────────────
 * It does not date the reversal to the original's day. A book that lets a
 * March correction land in October is a book whose closed months change after
 * they are read, and the *point* of a reversal is that it is visible.
 *
 * It does not touch the original row. `reverses_transaction_id` on the new one
 * is the whole of the link, and it points the way a reader travels: from the
 * correction back to what was corrected.
 *
 * Refuses to reverse a reversal, and refuses to reverse the same transaction
 * twice — the second would double the correction, and a school that reversed a
 * 50,000 payment twice would be 50,000 up on its own books with nothing on
 * screen saying why.
 */
export async function reverseTransaction(
  tx: Tx,
  input: {
    locationId: string;
    transactionId: string;
    entryDate: string;
    reason: string;
    createdByUid: string;
  },
): Promise<string> {
  const [original] = await tx
    .select({
      id: ledgerTransactions.id,
      branchId: ledgerTransactions.branchId,
      memo: ledgerTransactions.memo,
      source: ledgerTransactions.source,
      sourceId: ledgerTransactions.sourceId,
      reversesTransactionId: ledgerTransactions.reversesTransactionId,
    })
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.id, input.transactionId),
        eq(ledgerTransactions.locationId, input.locationId),
      ),
    )
    .limit(1);

  if (original === undefined) {
    throw new LedgerError('That entry could not be found.');
  }

  if (original.reversesTransactionId !== null) {
    throw new LedgerError(
      'That entry is itself a reversal. Reversing it would restore the mistake — post a fresh entry instead.',
    );
  }

  const [alreadyReversed] = await tx
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.locationId, input.locationId),
        eq(ledgerTransactions.reversesTransactionId, input.transactionId),
      ),
    )
    .limit(1);

  if (alreadyReversed !== undefined) {
    throw new LedgerError('That entry has already been reversed.');
  }

  const lines = await tx
    .select({
      accountId: ledgerEntries.accountId,
      debit: ledgerEntries.debit,
      credit: ledgerEntries.credit,
      memo: ledgerEntries.memo,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.transactionId, input.transactionId));

  const mirrored = mirrorLines(
    lines.map((line) => ({
      accountId: line.accountId,
      debitPaise: toPaise(line.debit),
      creditPaise: toPaise(line.credit),
      memo: line.memo,
    })),
  );

  return postTransaction(tx, {
    locationId: input.locationId,
    branchId: original.branchId,
    entryDate: input.entryDate,
    memo: `Reversal — ${original.memo}${input.reason === '' ? '' : ` (${input.reason})`}`,
    source: 'reversal',
    sourceId: original.sourceId,
    createdByUid: input.createdByUid,
    reversesTransactionId: original.id,
    lines: mirrored,
  });
}

/* -----------------------------------------------------------------------------
 * Finding the accounts the code posts to
 * -------------------------------------------------------------------------- */

/** The school's system accounts, keyed by `system_key`. */
export type SystemAccounts = Partial<Record<SystemAccountKey, LedgerAccount>>;

export async function loadSystemAccounts(
  locationId: string,
  runner: Tx | Database = db,
): Promise<SystemAccounts> {
  const rows = await runner
    .select()
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.locationId, locationId));

  const accounts: SystemAccounts = {};
  for (const row of rows) {
    if (row.systemKey !== null) accounts[row.systemKey] = row;
  }
  return accounts;
}

/**
 * One system account, or a refusal naming which one is missing.
 *
 * The message is deliberately specific. "Something went wrong" on a fee
 * payment sends a clerk to support; "This school has no Fee Income account"
 * sends whoever reads it to the chart of accounts, which is where the answer
 * is.
 */
export function requireSystemAccount(
  accounts: SystemAccounts,
  key: SystemAccountKey,
  label: string,
): LedgerAccount {
  const account = accounts[key];
  if (account === undefined) {
    throw new LedgerError(
      `This school has no ${label} account, so the entry has nowhere to post. Add one on the chart of accounts.`,
    );
  }
  return account;
}

/**
 * The account a member of staff's takings land in — theirs if they have one.
 *
 * This is the whole per-staff cash design in one function, and it is why the
 * fee payment route does not have to know whether the person at the counter
 * keeps their own float: it asks, and gets either their account or the office
 * drawer. A school that has never opened a staff cash account gets exactly the
 * behaviour it had before this sprint.
 */
export async function cashAccountForStaff(
  locationId: string,
  schoolUserId: string | null,
  fallback: LedgerAccount,
  runner: Tx | Database = db,
): Promise<LedgerAccount> {
  if (schoolUserId === null) return fallback;

  const [own] = await runner
    .select()
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.locationId, locationId),
        eq(ledgerAccounts.ownerUserId, schoolUserId),
        eq(ledgerAccounts.isActive, true),
      ),
    )
    .limit(1);

  return own ?? fallback;
}
