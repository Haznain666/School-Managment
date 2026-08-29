import { GENDERS, GUARDIAN_RELATIONSHIPS } from '@/db/schema';

/**
 * What a student import understands, and what counts as a valid row.
 *
 * **Dependency-free on purpose.** The mapping screen suggests columns and
 * previews errors in the browser; the dry run and the commit apply the same
 * rules on the server. Three places, one definition — a preview that promises
 * a row will import and a commit that then refuses it is worse than no preview,
 * because the operator has already fixed everything the preview complained
 * about and believes the file is clean.
 */

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  /** Shown under the field on the mapping screen. */
  hint?: string;
  /**
   * Lower-cased header fragments that suggest this field.
   *
   * Used only to pre-select the mapping — never to decide it. Guessing wrong
   * silently is how 400 fathers' phone numbers land in the mothers' column, so
   * the operator confirms every guess before anything is validated.
   */
  aliases: readonly string[];
}

/**
 * The importable fields.
 *
 * Deliberately smaller than the enrollment form. An import gets a school's roll
 * *in*; the details a school fills in over the first term — blood group,
 * medical notes, previous school, photo — are not what a migration spreadsheet
 * carries, and offering thirty columns to map is how the mapping screen becomes
 * the reason nobody imports.
 *
 * One guardian, not three. A spreadsheet row is one line; the second and third
 * guardians are added per student afterwards, and a school migrating 400
 * children has one contact number for each of them, not three.
 */
export const IMPORT_FIELDS: readonly ImportField[] = [
  {
    key: 'name',
    label: 'Student name',
    required: true,
    hint: 'Full name, as it should appear on a report card.',
    aliases: ['student name', 'name', 'full name', 'student', 'child name'],
  },
  {
    key: 'admissionNumber',
    label: 'Admission number',
    required: false,
    hint: 'Their existing number. Left unmapped, the school issues new ones.',
    aliases: ['admission', 'admission no', 'admission number', 'gr no', 'gr number', 'roll no', 'reg no', 'registration'],
  },
  {
    key: 'dateOfBirth',
    label: 'Date of birth',
    required: false,
    hint: 'Any of 2015-03-09, 09/03/2015 or 9-3-2015.',
    aliases: ['dob', 'date of birth', 'birth date', 'birthday'],
  },
  {
    key: 'gender',
    label: 'Gender',
    required: false,
    aliases: ['gender', 'sex'],
  },
  {
    key: 'rollNumber',
    label: 'Class roll number',
    required: false,
    hint: 'Their number within the section, if the school keeps one.',
    aliases: ['roll', 'roll number', 'class roll'],
  },
  {
    key: 'bFormCnic',
    label: 'B-Form / CNIC',
    required: false,
    aliases: ['b-form', 'bform', 'b form', 'cnic', 'nic'],
  },
  {
    key: 'guardianName',
    label: 'Guardian name',
    required: true,
    hint: 'Who the school contacts. Usually the father or mother.',
    aliases: ['father name', "father's name", 'guardian name', 'parent name', 'father', 'guardian', 'parent'],
  },
  {
    key: 'guardianPhone',
    label: 'Guardian phone',
    required: true,
    hint: 'A Pakistani mobile. 03001234567 and +923001234567 both work.',
    aliases: ['phone', 'mobile', 'contact', 'cell', 'father contact', 'guardian phone', 'parent phone', 'contact number'],
  },
  {
    key: 'guardianEmail',
    label: 'Guardian email',
    required: false,
    hint: 'Their sign-in identity if they are ever given a portal account.',
    aliases: ['email', 'e-mail', 'guardian email', 'parent email', 'father email'],
  },
  {
    key: 'guardianRelationship',
    label: 'Relationship',
    required: false,
    hint: 'Father, mother, guardian… Left unmapped, everyone is a guardian.',
    aliases: ['relation', 'relationship', 'guardian relation'],
  },
];

export const REQUIRED_FIELDS = IMPORT_FIELDS.filter((field) => field.required);

/** A row parsed into the shape `enrollStudent` wants, before it is written. */
export interface ImportCandidate {
  name: string;
  admissionNumber: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  rollNumber: string | null;
  bFormCnic: string | null;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
  guardianRelationship: string;
}

export interface RowValidation {
  candidate: ImportCandidate | null;
  errors: string[];
}

/**
 * Suggests a mapping from the file's own headers.
 *
 * Longest alias wins, so "father contact" beats "contact" and does not get
 * claimed by the plain phone field first. A header already claimed by an
 * earlier field is not offered twice.
 */
export function suggestColumnMap(columns: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const taken = new Set<string>();

  const scored = IMPORT_FIELDS.flatMap((field) =>
    field.aliases.map((alias) => ({ field: field.key, alias })),
  ).sort((a, b) => b.alias.length - a.alias.length);

  for (const { field, alias } of scored) {
    if (map[field] !== undefined) continue;

    const match = columns.find(
      (column) => !taken.has(column) && column.trim().toLowerCase() === alias,
    );
    if (match !== undefined) {
      map[field] = match;
      taken.add(match);
    }
  }

  // Second pass: substring matches, for headers like "Father's Mobile No.".
  for (const { field, alias } of scored) {
    if (map[field] !== undefined) continue;

    const match = columns.find(
      (column) => !taken.has(column) && column.trim().toLowerCase().includes(alias),
    );
    if (match !== undefined) {
      map[field] = match;
      taken.add(match);
    }
  }

  return map;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOOSE_DATE = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/;

/**
 * Reads a date the way a spreadsheet actually holds one.
 *
 * `2015-03-09`, `09/03/2015` and `9-3-2015` all appear in real exports, and a
 * school in Pakistan writes day first. **Ambiguous values are read
 * day-first**, so `03/09/2015` is the 3rd of September. That is a guess, and it
 * is the right one here, but it is why the dry-run report shows the parsed date
 * back rather than only saying "valid" — a birthday silently shifted by six
 * months is not something anyone would notice on a count.
 */
export function parseImportDate(value: string): string | null {
  const text = value.trim();
  if (text === '') return null;

  const iso = ISO_DATE.exec(text);
  if (iso !== null) {
    return isRealDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) ? text : null;
  }

  const loose = LOOSE_DATE.exec(text);
  if (loose === null) return null;

  const first = Number(loose[1]);
  const second = Number(loose[2]);
  const third = Number(loose[3]);

  // `2015/03/09` — a four-digit leading part can only be the year.
  const [year, month, day] =
    String(loose[1]).length === 4 ? [first, second, third] : [third, second, first];

  if (!isRealDate(year, month, day)) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;

  // Rejects 31 February rather than rolling it into March, which is what
  // `new Date()` would do and is how a nonsense birthday becomes a real one.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * Normalises a Pakistani mobile to E.164, or returns null.
 *
 * Kept here rather than reaching for `lib/phone.ts` because that module is
 * server-side and this one is read in the browser. The commit re-normalises
 * through `lib/phone.ts` anyway — this is the check that lets the dry run say
 * "row 47: 0300-123 is not a mobile number" before anything is written.
 */
export function normaliseImportPhone(value: string): string | null {
  const digits = value.replace(/[^\d+]/g, '');
  if (digits === '') return null;

  const bare = digits.replace(/^\+?92/, '').replace(/^0/, '');

  // A Pakistani mobile is 3 followed by nine more digits.
  return /^3\d{9}$/.test(bare) ? `+92${bare}` : null;
}

/**
 * One mapped value out of a raw row.
 *
 * Exported because the duplicate-admission-number check needs the number
 * whether or not the rest of the row is valid. Reading it off the parsed
 * candidate instead — which is null the moment a row has any other error —
 * makes a duplicate invisible until the *other* problem is fixed, so the
 * operator corrects an email address, re-uploads, and only then discovers the
 * collision. See `validateBatch`.
 */
export function mappedValue(
  row: Record<string, string>,
  columnMap: Record<string, string>,
  field: string,
): string {
  const column = columnMap[field];
  if (column === undefined || column === '') return '';
  return (row[column] ?? '').trim();
}

const readMapped = mappedValue;

/**
 * Validates one row against the mapping.
 *
 * Every problem with the row is collected rather than the first one returned.
 * A row is usually wrong in several ways at once, and reporting them one per
 * re-upload is how a 400-row import takes an afternoon.
 */
export function validateRow(
  row: Record<string, string>,
  columnMap: Record<string, string>,
): RowValidation {
  const errors: string[] = [];
  const read = (field: string) => readMapped(row, columnMap, field);

  const name = read('name');
  if (name === '') errors.push('Student name is missing.');

  const guardianName = read('guardianName');
  if (guardianName === '') errors.push('Guardian name is missing.');

  const rawPhone = read('guardianPhone');
  const guardianPhone = rawPhone === '' ? null : normaliseImportPhone(rawPhone);
  if (rawPhone === '') {
    errors.push('Guardian phone is missing.');
  } else if (guardianPhone === null) {
    errors.push(`“${rawPhone}” is not a Pakistani mobile number.`);
  }

  const rawDob = read('dateOfBirth');
  const dateOfBirth = rawDob === '' ? null : parseImportDate(rawDob);
  if (rawDob !== '' && dateOfBirth === null) {
    errors.push(`“${rawDob}” is not a date.`);
  }

  const rawGender = read('gender').toLowerCase();
  let gender: string | null = null;
  if (rawGender !== '') {
    // `M` / `F` are far more common in exports than `male` / `female`.
    const canonical =
      rawGender === 'm' ? 'male' : rawGender === 'f' ? 'female' : rawGender;
    if ((GENDERS as readonly string[]).includes(canonical)) {
      gender = canonical;
    } else {
      errors.push(`“${read('gender')}” is not a gender.`);
    }
  }

  const rawRelationship = read('guardianRelationship').toLowerCase();
  let guardianRelationship = 'guardian';
  if (rawRelationship !== '') {
    if ((GUARDIAN_RELATIONSHIPS as readonly string[]).includes(rawRelationship)) {
      guardianRelationship = rawRelationship;
    } else {
      // Not an error. "Uncle", "Grandfather" and "Khala" all appear in real
      // files, and refusing the row over a relationship label would block an
      // import for a field the school can correct in a second afterwards.
      guardianRelationship = 'other';
    }
  }

  const rawEmail = read('guardianEmail');
  let guardianEmail: string | null = null;
  if (rawEmail !== '') {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      guardianEmail = rawEmail.toLowerCase();
    } else {
      errors.push(`“${rawEmail}” is not an email address.`);
    }
  }

  if (errors.length > 0 || guardianPhone === null) {
    return { candidate: null, errors };
  }

  const admissionNumber = read('admissionNumber');
  const rollNumber = read('rollNumber');
  const bFormCnic = read('bFormCnic');

  return {
    candidate: {
      name,
      admissionNumber: admissionNumber === '' ? null : admissionNumber,
      dateOfBirth,
      gender,
      rollNumber: rollNumber === '' ? null : rollNumber,
      bFormCnic: bFormCnic === '' ? null : bFormCnic,
      guardianName,
      guardianPhone,
      guardianEmail,
      guardianRelationship,
    },
    errors: [],
  };
}

/**
 * Rows that collide with each other inside the same file.
 *
 * Checked separately from `validateRow` because it is a property of the batch,
 * not of any one row, and because the answer names both offenders. A file with
 * the same admission number twice is nearly always a copy-paste while
 * assembling it, and importing both creates two children who are one child.
 */
export function findDuplicateAdmissionNumbers(
  candidates: ReadonlyArray<{ rowNumber: number; admissionNumber: string | null }>,
): Map<number, string> {
  const byNumber = new Map<string, number[]>();

  for (const entry of candidates) {
    if (entry.admissionNumber === null) continue;
    const key = entry.admissionNumber.trim().toLowerCase();
    byNumber.set(key, [...(byNumber.get(key) ?? []), entry.rowNumber]);
  }

  const problems = new Map<number, string>();

  for (const [key, rowNumbers] of byNumber) {
    if (rowNumbers.length < 2) continue;
    for (const rowNumber of rowNumbers) {
      const others = rowNumbers.filter((n) => n !== rowNumber);
      problems.set(
        rowNumber,
        `Admission number “${key}” also appears on row ${others.join(', ')}.`,
      );
    }
  }

  return problems;
}
