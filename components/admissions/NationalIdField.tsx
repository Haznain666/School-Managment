'use client';

import { Select } from '@/components/ui/Select';
import { SecretInput } from '@/components/ui/SecretInput';
import {
  ID_DOCUMENT_TYPES,
  ID_DOCUMENT_TYPE_LABELS,
  type IdDocumentType,
} from '@/db/schema/student-profiles';
import { formatCnic, isValidCnic, maskNationalId } from '@/lib/national-id';

/**
 * The identity-document pair: which document, then its number.
 *
 * One field in two halves rather than two fields, because neither half means
 * anything alone — a number with no document is what the old single "B-Form /
 * CNIC" box recorded, and a document with no number records nothing at all.
 * Both the enrolment form and the student profile use this, so the mask, the
 * validation and the reveal behave identically wherever a number is entered.
 *
 * The two documents are deliberately not validated alike. A CNIC has one
 * national format and is reformatted and refused accordingly; a B-Form is typed
 * as it appears on the certificate. `lib/national-id.ts` carries the reasoning.
 */

const TYPE_OPTIONS = ID_DOCUMENT_TYPES.map((value) => ({
  value,
  label: ID_DOCUMENT_TYPE_LABELS[value],
}));

export interface NationalIdValue {
  /** '' until a document has been chosen. */
  documentType: IdDocumentType | '';
  number: string;
}

export function emptyNationalId(): NationalIdValue {
  return { documentType: '', number: '' };
}

/**
 * The one rule the form and the review step both need: what is wrong with this
 * pair, or null when nothing is.
 *
 * A blank number is not an error — neither document is compulsory to admit a
 * child, and a school chasing paperwork must still be able to enrol them.
 */
export function nationalIdProblem(value: NationalIdValue): string | null {
  if (value.number.trim() === '') return null;

  if (value.documentType === '') {
    return 'Choose whether that number is a CNIC / Smart Card or a B-Form.';
  }

  if (value.documentType === 'cnic' && !isValidCnic(value.number)) {
    return 'A CNIC / Smart Card number is 13 digits, as 42101-1234567-1.';
  }

  return null;
}

export interface NationalIdFieldProps {
  value: NationalIdValue;
  onChange: (value: NationalIdValue) => void;
  disabled?: boolean;
  /** Shown under the number field. Set when the step has been validated. */
  error?: string;
}

export function NationalIdField({
  value,
  onChange,
  disabled = false,
  error,
}: NationalIdFieldProps) {
  const isCnic = value.documentType === 'cnic';

  const setType = (documentType: IdDocumentType | ''): void => {
    // Switching to CNIC reformats whatever has already been typed rather than
    // discarding it: the clerk has the same card in front of them either way,
    // and silently emptying a filled field reads as a bug.
    onChange({
      documentType,
      number: documentType === 'cnic' ? formatCnic(value.number) : value.number,
    });
  };

  return (
    <>
      <Select
        label="Identity document"
        placeholder="Select"
        options={TYPE_OPTIONS}
        value={value.documentType}
        disabled={disabled}
        onChange={(event) => {
          setType(event.target.value as IdDocumentType | '');
        }}
      />

      <SecretInput
        label={
          value.documentType === ''
            ? 'Document number'
            : ID_DOCUMENT_TYPE_LABELS[value.documentType]
        }
        revealLabel={
          value.documentType === ''
            ? 'document number'
            : ID_DOCUMENT_TYPE_LABELS[value.documentType]
        }
        mask={maskNationalId}
        value={value.number}
        error={error}
        hint={
          error === undefined && isCnic
            ? 'Digits only — 5, then 7, then 1.'
            : undefined
        }
        placeholder={isCnic ? '42101-1234567-1' : 'As printed on the B-Form'}
        inputMode={isCnic ? 'numeric' : 'text'}
        // A document has to be chosen first: the field cannot know how to
        // validate — or even what to call itself — until it is.
        disabled={disabled || value.documentType === ''}
        maxLength={isCnic ? 15 : 50}
        onChange={(event) => {
          const raw = event.target.value;
          onChange({
            ...value,
            number: isCnic ? formatCnic(raw) : raw,
          });
        }}
      />
    </>
  );
}
