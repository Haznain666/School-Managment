import { isBankPurpose } from '@/db/schema/bank-accounts';
import type { BankAccountInput } from '@/lib/bank-accounts';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * One reader for a bank account's body, shared by POST and PATCH.
 *
 * Written once for the reason `readSchemeInput` beside it is: the two routes
 * accept exactly the same thing, and the failure mode of two copies is a
 * validator that refuses a blank account number on create and accepts one on
 * edit. That is not hypothetical here — an account number is the one field on
 * this form a parent will type into their banking app.
 *
 * Returns the parsed input, or the sentence to show the person who typed it.
 */
export function readBankAccountInput(
  body: Record<string, unknown>,
): BankAccountInput | string {
  const accountTitle = readString(body['accountTitle']);
  if (accountTitle === '' || accountTitle.length > 160) {
    return 'Enter the account title — the name the bank holds the account under.';
  }

  const bankName = readString(body['bankName']);
  if (bankName === '' || bankName.length > 160) {
    return 'Enter the name of the bank.';
  }

  const accountNumber = readString(body['accountNumber']);
  if (accountNumber === '' || accountNumber.length > 64) {
    return 'Enter the account number.';
  }

  if (!isBankPurpose(body['purpose'])) {
    return 'Choose whether this account is for students, for staff, or for both.';
  }

  /*
   * `PKR` unless the school says otherwise, and never blank.
   *
   * Stored rather than assumed because a school with an overseas fee account
   * has one in USD, and printing `PKR` beside it would be wrong in the one
   * place being wrong costs a parent a wire fee. Upper-cased and capped at
   * three characters so a voucher cannot print `pakistani rupees` where an ISO
   * code belongs.
   */
  const rawCurrency = readString(body['currency']).toUpperCase();
  if (rawCurrency !== '' && !/^[A-Z]{3}$/.test(rawCurrency)) {
    return 'Enter a three-letter currency code, e.g. PKR or USD.';
  }

  const rawSort = body['sortOrder'];
  const sortOrder = rawSort === undefined || rawSort === null ? 0 : Number(rawSort);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
    return 'The print order must be a whole number between 0 and 999.';
  }

  // Null is the school-wide answer and is legal. `branchForWrite` in the route
  // decides whether *this* caller may write it, which is a different question
  // from whether the value is well formed.
  const rawBranch = body['branchId'];
  if (rawBranch !== null && rawBranch !== undefined && rawBranch !== '' && !isUuid(rawBranch)) {
    return 'That campus does not exist.';
  }

  const optional = (key: string, limit: number): string | null | 'too_long' => {
    const value = readOptionalString(body[key]);
    if (value !== null && value.length > limit) return 'too_long';
    return value;
  };

  const fields = {
    branchNameOfBank: optional('branchNameOfBank', 160),
    branchCode: optional('branchCode', 32),
    iban: optional('iban', 64),
    swiftCode: optional('swiftCode', 32),
    bankAddress: optional('bankAddress', 400),
    intermediaryBank: optional('intermediaryBank', 160),
    intermediarySwift: optional('intermediarySwift', 32),
    instructions: optional('instructions', 500),
  };

  for (const value of Object.values(fields)) {
    if (value === 'too_long') return 'One of those values is too long.';
  }

  return {
    branchId: isUuid(rawBranch) ? rawBranch : null,
    accountTitle,
    bankName,
    branchNameOfBank: fields.branchNameOfBank as string | null,
    branchCode: fields.branchCode as string | null,
    accountNumber,
    iban: fields.iban as string | null,
    swiftCode: fields.swiftCode as string | null,
    bankAddress: fields.bankAddress as string | null,
    intermediaryBank: fields.intermediaryBank as string | null,
    intermediarySwift: fields.intermediarySwift as string | null,
    currency: rawCurrency === '' ? 'PKR' : rawCurrency,
    purpose: body['purpose'],
    instructions: fields.instructions as string | null,
    // Absent means active: an account is added to be used, and the toggle is
    // for switching one off later.
    isActive: body['isActive'] === undefined ? true : body['isActive'] === true,
    sortOrder,
  };
}
