import { ibanProblem, normalizeIban } from './platform-billing';

/**
 * Reads a platform bank account from a request body — Sprint 35, §5.
 *
 * Shared by the create and the edit route so the two cannot disagree about
 * what an account is. Pakistani accounts only: bank, title, number and a
 * checksum-valid `PK` IBAN are required; branch name, branch code and city are
 * optional. There is no SWIFT or routing field because nobody paying these is
 * abroad, and a field nobody fills in is a field that ends up printed blank on
 * every invoice.
 */

export interface BankAccountBody {
  bankName?: unknown;
  accountTitle?: unknown;
  accountNumber?: unknown;
  iban?: unknown;
  branchName?: unknown;
  branchCode?: unknown;
  city?: unknown;
}

export type BankAccountRead =
  | {
      ok: true;
      value: {
        bankName: string;
        accountTitle: string;
        accountNumber: string;
        iban: string;
        branchName: string | null;
        branchCode: string | null;
        city: string | null;
      };
    }
  | { ok: false; message: string };

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optional(value: unknown, max: number): string | null {
  const read = text(value, max);
  return read === '' ? null : read;
}

export function readBankAccountBody(body: BankAccountBody | null): BankAccountRead {
  if (body === null) return { ok: false, message: 'Expected a JSON body.' };

  const bankName = text(body.bankName, 120);
  const accountTitle = text(body.accountTitle, 160);
  const accountNumber = text(body.accountNumber, 40);

  if (bankName === '') return { ok: false, message: 'Enter the bank name.' };
  if (accountTitle === '') return { ok: false, message: 'Enter the account title.' };
  if (accountNumber === '') return { ok: false, message: 'Enter the account number.' };

  const problem = ibanProblem(body.iban);
  if (problem !== null) return { ok: false, message: problem };

  return {
    ok: true,
    value: {
      bankName,
      accountTitle,
      accountNumber,
      iban: normalizeIban(String(body.iban)),
      branchName: optional(body.branchName, 120),
      branchCode: optional(body.branchCode, 20),
      city: optional(body.city, 80),
    },
  };
}
