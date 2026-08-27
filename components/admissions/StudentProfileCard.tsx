'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import {
  NationalIdField,
  nationalIdProblem,
  type NationalIdValue,
} from '@/components/admissions/NationalIdField';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import {
  BLOOD_GROUPS,
  GENDERS,
  ID_DOCUMENT_TYPE_LABELS,
  isIdDocumentType,
} from '@/db/schema/student-profiles';
import { formatPkr, toPaise } from '@/lib/money';
import { maskNationalId } from '@/lib/national-id';
import {
  schoolErrorMessage,
  schoolFetch,
  withSchoolParam,
} from '@/lib/school-client';
import {
  NATIONALITIES,
  RELIGIONS,
  optionsWithCurrent,
} from '@/lib/student-reference-data';

/**
 * A student's personal details, viewable and editable in place.
 *
 * The admission number and the class placement are shown but not editable
 * here: the number is what the school prints on everything, and moving a child
 * between sections is an enrolment change rather than a profile edit.
 */

export interface StudentProfileValues {
  studentProfileId: string;
  studentId: string;
  name: string;
  dateOfBirth: string | null;
  gender: string | null;
  bFormCnic: string | null;
  /** 'cnic' | 'b_form'. Null on records admitted before it was asked for. */
  idDocumentType: string | null;
  bloodGroup: string | null;
  nationality: string;
  religion: string | null;
  previousSchool: string | null;
  medicalNotes: string | null;
  photoUrl: string | null;
  ghlContactId: string | null;
}

export interface StudentProfileCardProps {
  student: StudentProfileValues;
  canEdit: boolean;
  /**
   * What went wrong with the photo the enrolment wizard tried to upload.
   *
   * Carried here on `?photo=failed&reason=…` because the wizard is gone by the
   * time this page renders. Before Sprint 17 the wizard swallowed the failure
   * entirely — no `response.ok` check, a `console.warn`, and a profile with a
   * blank avatar and no explanation. *Student 5* on the live tenant still has
   * `photo_url = null` from exactly that.
   */
  photoUploadProblem?: string | null;
  /**
   * Credit carried forward, in PKR, and the challan that created it.
   *
   * Rendered here because a credit nobody can see is a credit nobody trusts —
   * a parent asking where their discount went has to be answerable from the
   * child's own record and not only from the fee module.
   */
  credit?: {
    balance: string;
    sourceChallanId: string | null;
    sourceChallanNumber: string | null;
  } | null;
}

const GENDER_OPTIONS = [
  { value: '', label: 'Not recorded' },
  ...GENDERS.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  })),
];

const BLOOD_GROUP_OPTIONS = [
  { value: '', label: 'Unknown' },
  ...BLOOD_GROUPS.map((value) => ({ value, label: value })),
];

/** Initials for the avatar shown when a student has no photo. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function StudentProfileCard({
  student,
  canEdit,
  photoUploadProblem = null,
  credit = null,
}: StudentProfileCardProps) {
  const router = useRouter();
  const photoInput = useRef<HTMLInputElement | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [values, setValues] = useState({
    dateOfBirth: student.dateOfBirth ?? '',
    gender: student.gender ?? '',
    nationalId: {
      documentType: isIdDocumentType(student.idDocumentType)
        ? student.idDocumentType
        : '',
      number: student.bFormCnic ?? '',
    } as NationalIdValue,
    bloodGroup: student.bloodGroup ?? '',
    nationality: student.nationality,
    religion: student.religion ?? '',
    previousSchool: student.previousSchool ?? '',
    medicalNotes: student.medicalNotes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const save = async (): Promise<void> => {
    const problem = nationalIdProblem(values.nationalId);
    if (problem !== null) {
      setError(problem);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await schoolFetch(`/api/school/students/${student.studentProfileId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          dateOfBirth: values.dateOfBirth === '' ? null : values.dateOfBirth,
          gender: values.gender === '' ? null : values.gender,
          bFormCnic: values.nationalId.number,
          idDocumentType:
            values.nationalId.number.trim() === ''
              ? null
              : values.nationalId.documentType,
          bloodGroup: values.bloodGroup === '' ? null : values.bloodGroup,
          nationality: values.nationality,
          religion: values.religion,
          previousSchool: values.previousSchool,
          medicalNotes: values.medicalNotes,
        }),
      });

      setIsEditing(false);
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the changes.'));
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Replaces the photo, immediately, from the profile.
   *
   * ── Why this had to exist ────────────────────────────────────────────
   * The card rendered `photoUrl` and had an Edit mode for every text field and
   * nothing at all that touched the image. So a photo that failed to upload
   * during enrolment, or one taken on the wrong day, could not be changed from
   * anywhere in this product.
   *
   * The endpoint is the one the wizard already calls, and it appends
   * `?v=<timestamp>` to the stored URL, so `router.refresh()` is enough — the
   * browser is not holding a cached image behind an unchanged src. Storage
   * itself needs nothing: `uploadBuffer` sends `x-upsert: true`, so writing the
   * same deterministic path replaces the object rather than being refused.
   *
   * Errors surface in the card and not in the console. That distinction is the
   * whole of defect 11b.
   */
  const uploadPhoto = async (file: File): Promise<void> => {
    setPhotoBusy(true);
    setPhotoError(null);
    setPhotoNotice(null);

    try {
      const form = new FormData();
      form.append('photo', file);

      const response = await fetch(
        withSchoolParam(`/api/school/students/${student.studentProfileId}/photo`),
        { method: 'POST', body: form },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;

        setPhotoError(
          payload?.error?.message ??
            `The photo could not be uploaded (HTTP ${response.status}).`,
        );
        return;
      }

      setPhotoNotice('Photo updated.');
      router.refresh();
    } catch (caught) {
      setPhotoError(schoolErrorMessage(caught, 'The photo could not be uploaded.'));
    } finally {
      setPhotoBusy(false);
      // Cleared so selecting the *same* file again still fires `change`.
      if (photoInput.current !== null) photoInput.current.value = '';
    }
  };

  return (
    <Card
      header={
        <CardTitle
          title="Student information"
          action={
            canEdit && !isEditing ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setIsEditing(true);
                }}
              >
                Edit
              </Button>
            ) : undefined
          }
        />
      }
    >
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="shrink-0">
          {student.photoUrl === null || student.photoUrl === '' ? (
            <span
              aria-hidden="true"
              className="flex h-24 w-24 items-center justify-center rounded-xl bg-brand-primary text-2xl font-bold text-brand-onPrimary"
            >
              {initialsOf(student.name)}
            </span>
          ) : (
            // Photo dimensions vary per upload; a plain <img> avoids forcing one.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={student.photoUrl}
              alt={`${student.name}`}
              className="h-24 w-24 rounded-xl object-cover"
            />
          )}

          {canEdit ? (
            <>
              <input
                ref={photoInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) void uploadPhoto(file);
                }}
              />
              <button
                type="button"
                disabled={photoBusy}
                className="mt-2 block w-24 text-center text-xs font-medium text-brand-primary hover:underline disabled:text-ink-muted"
                onClick={() => {
                  photoInput.current?.click();
                }}
              >
                {photoBusy
                  ? 'Uploading…'
                  : student.photoUrl === null || student.photoUrl === ''
                    ? 'Add photo'
                    : 'Change photo'}
              </button>
            </>
          ) : null}

          <p className="mt-3 font-mono text-xs text-ink-muted">{student.studentId}</p>
          <Badge
            className="mt-2"
            variant={student.ghlContactId === null ? 'warning' : 'success'}
          >
            {student.ghlContactId === null ? 'Not in GHL' : 'Synced to GHL'}
          </Badge>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-ink">{student.name}</h3>

          {/*
            The enrolment wizard's upload failure, named. Shown until the photo
            is replaced — it is not a toast, because the person who needs to see
            it may open this page hours after the admission.
          */}
          {photoUploadProblem === null || photoError !== null ? null : (
            <p
              role="alert"
              className="mt-2 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
            >
              The photo chosen during enrolment was not saved. {photoUploadProblem}{' '}
              {canEdit ? 'Use “Add photo” to upload it again.' : null}
            </p>
          )}

          {photoError === null ? null : (
            <p
              role="alert"
              className="mt-2 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
            >
              {photoError}
            </p>
          )}

          {photoNotice === null ? null : (
            <p className="mt-2 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle">
              {photoNotice}
            </p>
          )}

          {credit === null || toPaise(credit.balance) <= 0 ? null : (
            <p className="mt-2 text-sm text-ink">
              <span className="font-medium">
                Credit carried forward: {formatPkr(credit.balance)}
              </span>{' '}
              <span className="text-ink-muted">
                — it comes off the next voucher as an adjustment
                {credit.sourceChallanId === null ? '.' : ' '}
              </span>
              {credit.sourceChallanId === null ? null : (
                <Link
                  href={`/dashboard/fees/challans/${credit.sourceChallanId}`}
                  className="font-medium text-brand-primary hover:underline"
                >
                  (from {credit.sourceChallanNumber}).
                </Link>
              )}
            </p>
          )}

          {isEditing ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Input
                label="Date of birth"
                type="date"
                value={values.dateOfBirth}
                disabled={isSaving}
                onChange={(event) => {
                  setValues((current) => ({ ...current, dateOfBirth: event.target.value }));
                }}
              />
              <Select
                label="Gender"
                options={GENDER_OPTIONS}
                value={values.gender}
                disabled={isSaving}
                onChange={(event) => {
                  setValues((current) => ({ ...current, gender: event.target.value }));
                }}
              />
              <NationalIdField
                value={values.nationalId}
                disabled={isSaving}
                onChange={(nationalId) => {
                  setValues((current) => ({ ...current, nationalId }));
                }}
              />
              <Select
                label="Blood group"
                options={BLOOD_GROUP_OPTIONS}
                value={values.bloodGroup}
                disabled={isSaving}
                onChange={(event) => {
                  setValues((current) => ({ ...current, bloodGroup: event.target.value }));
                }}
              />
              {/*
                Built from the *stored* value, not just the list: a religion
                recorded before this became a dropdown — or imported from the
                school's own spreadsheet — is still that child's religion, and
                an unmatched `<select>` would quietly re-point it at the first
                option the moment anything else on the form was saved.
              */}
              <Select
                label="Nationality"
                options={optionsWithCurrent(NATIONALITIES, values.nationality)}
                value={values.nationality}
                disabled={isSaving}
                onChange={(event) => {
                  setValues((current) => ({ ...current, nationality: event.target.value }));
                }}
              />
              <Select
                label="Religion"
                placeholder="Not recorded"
                options={optionsWithCurrent(RELIGIONS, values.religion)}
                value={values.religion}
                disabled={isSaving}
                onChange={(event) => {
                  setValues((current) => ({ ...current, religion: event.target.value }));
                }}
              />
              <div className="sm:col-span-2">
                <Input
                  label="Previous school"
                  value={values.previousSchool}
                  disabled={isSaving}
                  onChange={(event) => {
                    setValues((current) => ({
                      ...current,
                      previousSchool: event.target.value,
                    }));
                  }}
                />
              </div>
              <div className="sm:col-span-2">
                <Textarea
                  label="Medical notes"
                  value={values.medicalNotes}
                  disabled={isSaving}
                  onChange={(event) => {
                    setValues((current) => ({
                      ...current,
                      medicalNotes: event.target.value,
                    }));
                  }}
                />
              </div>

              {error !== null ? (
                <p
                  role="alert"
                  className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink sm:col-span-2"
                >
                  {error}
                </p>
              ) : null}

              <div className="flex gap-3 sm:col-span-2">
                <Button
                  isLoading={isSaving}
                  onClick={() => {
                    void save();
                  }}
                >
                  Save changes
                </Button>
                <Button
                  variant="secondary"
                  disabled={isSaving}
                  onClick={() => {
                    setIsEditing(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Date of birth" value={student.dateOfBirth} />
              <Detail label="Gender" value={student.gender} />
              <SecretDetail
                label={
                  isIdDocumentType(student.idDocumentType)
                    ? ID_DOCUMENT_TYPE_LABELS[student.idDocumentType]
                    : 'B-Form / CNIC'
                }
                value={student.bFormCnic}
              />
              <Detail label="Blood group" value={student.bloodGroup} />
              <Detail label="Nationality" value={student.nationality} />
              <Detail label="Religion" value={student.religion} />
              <Detail label="Previous school" value={student.previousSchool} />
              <Detail label="Medical notes" value={student.medicalNotes} />
            </dl>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * A detail whose value is masked until asked for.
 *
 * The profile page is the screen most likely to be open with a parent standing
 * at the counter, so an identity number stays covered here for the same reason
 * it does on the form that captured it — and it is revealed the same way, so
 * there is one gesture to learn rather than two.
 */
function SecretDetail({ label, value }: { label: string; value: string | null }) {
  const [revealed, setRevealed] = useState(false);
  const empty = value === null || value === '';

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 flex items-center gap-2 text-sm text-ink">
        <span className={revealed || empty ? undefined : 'tracking-wider'}>
          {empty ? '—' : revealed ? value : maskNationalId(value)}
        </span>

        {empty ? null : (
          <button
            type="button"
            aria-pressed={revealed}
            aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
            className="text-xs font-medium text-brand-primary hover:underline"
            onClick={() => {
              setRevealed((current) => !current);
            }}
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        )}
      </dd>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">
        {value === null || value === '' ? '—' : value}
      </dd>
    </div>
  );
}
