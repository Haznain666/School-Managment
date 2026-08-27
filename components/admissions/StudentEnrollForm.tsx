'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  AcademicPlacementForm,
  todayIso,
  type BranchOption,
  type PlacementDraft,
} from '@/components/admissions/AcademicPlacementForm';
import {
  emptyGuardian,
  guardiansProblem,
  GuardianForm,
  type GuardianDraft,
} from '@/components/admissions/GuardianForm';
import {
  emptyNationalId,
  NationalIdField,
  nationalIdProblem,
  type NationalIdValue,
} from '@/components/admissions/NationalIdField';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import {
  BLOOD_GROUPS,
  GENDERS,
  ID_DOCUMENT_TYPE_LABELS,
  type BloodGroup,
  type Gender,
} from '@/db/schema/student-profiles';
import { GUARDIAN_RELATIONSHIP_LABELS } from '@/db/schema/student-guardians';
import { formatCnic, maskNationalId } from '@/lib/national-id';
import { schoolErrorMessage, schoolFetch, withSchoolParam } from '@/lib/school-client';
import {
  DEFAULT_NATIONALITY,
  NATIONALITIES,
  RELIGIONS,
  optionsWithCurrent,
} from '@/lib/student-reference-data';

/**
 * Direct enrolment, in four steps: student, guardians, placement, review.
 *
 * Split into steps because the form is long and half of it is optional — an
 * admissions clerk with a paper form in front of them should not be scrolling
 * past twenty fields to find the two that are required. Each step validates
 * before the next opens, so a mistake surfaces next to the field that caused
 * it rather than at submit.
 */

const STEPS = [
  'Student information',
  'Guardian information',
  'Academic placement',
  'Review and confirm',
] as const;

const GENDER_OPTIONS = GENDERS.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

const BLOOD_GROUP_OPTIONS = [
  { value: '', label: 'Unknown' },
  ...BLOOD_GROUPS.map((value) => ({ value, label: value })),
];

const NATIONALITY_OPTIONS = optionsWithCurrent(NATIONALITIES, '');
const RELIGION_OPTIONS = optionsWithCurrent(RELIGIONS, '');

interface StudentDraft {
  name: string;
  dateOfBirth: string;
  gender: string;
  nationalId: NationalIdValue;
  bloodGroup: string;
  nationality: string;
  religion: string;
  previousSchool: string;
  medicalNotes: string;
}

export interface EnrollPrefill {
  studentName?: string;
  studentDob?: string | null;
  studentGender?: string | null;
  previousSchool?: string | null;
  guardianName?: string;
  guardianRelationship?: string;
  guardianPhone?: string;
  guardianEmail?: string | null;
  guardianCnic?: string | null;
  branchId?: string | null;
  gradeId?: string | null;
}

export interface StudentEnrollFormProps {
  branches: readonly BranchOption[];
  academicYearId: string;
  academicYearName: string;
  /** School code plus year, e.g. `GVS-2025-0007`. Null when none can be shown. */
  studentIdPreview: string | null;
  maxGuardians: number;
  /** From an accepted application being converted. */
  prefill?: EnrollPrefill;
}

function emptyStudent(): StudentDraft {
  return {
    name: '',
    dateOfBirth: '',
    gender: '',
    nationalId: emptyNationalId(),
    bloodGroup: '',
    nationality: DEFAULT_NATIONALITY,
    religion: '',
    previousSchool: '',
    medicalNotes: '',
  };
}

export function StudentEnrollForm({
  branches,
  academicYearId,
  academicYearName,
  studentIdPreview,
  maxGuardians,
  prefill,
}: StudentEnrollFormProps) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [student, setStudent] = useState<StudentDraft>(() => ({
    ...emptyStudent(),
    name: prefill?.studentName ?? '',
    dateOfBirth: prefill?.studentDob ?? '',
    gender: prefill?.studentGender ?? '',
    previousSchool: prefill?.previousSchool ?? '',
  }));

  const [guardians, setGuardians] = useState<GuardianDraft[]>(() => {
    const first = emptyGuardian(true);
    if (prefill === undefined) return [first];

    return [
      {
        ...first,
        name: prefill.guardianName ?? '',
        /*
         * An application carries whatever relationship the parent chose on the
         * public form, and the first guardian on an enrolment may only be
         * father, mother or sibling. Anything else lands on `father` rather
         * than being carried through into a value the step would then refuse —
         * the clerk is looking at the person and corrects it in one click.
         */
        relationship:
          prefill.guardianRelationship === 'mother' ||
          prefill.guardianRelationship === 'sibling'
            ? prefill.guardianRelationship
            : 'father',
        phone: prefill.guardianPhone ?? '',
        email: prefill.guardianEmail ?? '',
        // Through the mask, so a number typed into the public application form
        // as 13 bare digits arrives here in the one spelling the sibling lookup
        // can match on.
        cnic: formatCnic(prefill.guardianCnic ?? ''),
      },
    ];
  });

  const [placement, setPlacement] = useState<PlacementDraft>(() => ({
    branchId: prefill?.branchId ?? (branches.length === 1 ? (branches[0]?.id ?? '') : ''),
    gradeId: prefill?.gradeId ?? '',
    sectionId: '',
    rollNumber: '',
    enrollmentDate: todayIso(),
  }));

  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /*
   * A thumbnail of what is actually held, because the input cannot be trusted
   * to show it.
   *
   * The wizard renders its steps conditionally, so the `<input type="file">`
   * is unmounted and remounted **empty** every time somebody leaves step 1 and
   * comes back. The `photo` state survived that all along; what disappeared
   * was the file name beside the button, which is the only thing anybody was
   * looking at — so the photo was re-selected, and the report came in as "the
   * photo does not stay".
   *
   * Rendering the held `File` rather than relying on the control is the fix,
   * and the object URL is revoked on change and on unmount because each one
   * pins the file's bytes in memory until it is.
   */
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (photo === null) {
      setPhotoPreview(null);
      return;
    }

    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [photo]);

  const branchName = useMemo(
    () => branches.find((branch) => branch.id === placement.branchId)?.name ?? '—',
    [branches, placement.branchId],
  );

  const setStudentField = useCallback(
    <K extends keyof StudentDraft>(key: K, value: StudentDraft[K]) => {
      setStudent((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  // A validation message is about the step the user just left, so it is cleared
  // as soon as they move — otherwise a fixed error keeps accusing them.
  useEffect(() => {
    setError(null);
  }, [step]);

  const stepProblem = (index: number): string | null => {
    if (index === 0) {
      if (student.name.trim() === '') return 'Enter the student’s full name.';
      return nationalIdProblem(student.nationalId);
    }

    // Every guardian rule lives on the form that draws the fields, so the two
    // cannot drift. See `guardiansProblem`.
    if (index === 1) return guardiansProblem(guardians);

    if (index === 2) {
      if (placement.branchId === '') return 'Select a branch.';
      if (placement.gradeId === '') return 'Select a grade.';
      if (placement.sectionId === '') return 'Select a section.';
      return null;
    }

    return null;
  };

  const goNext = (): void => {
    const problem = stepProblem(step);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const submit = async (): Promise<void> => {
    for (let index = 0; index < 3; index += 1) {
      const problem = stepProblem(index);
      if (problem !== null) {
        setError(problem);
        setStep(index);
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const created = await schoolFetch<{
        student: { studentProfileId: string; studentId: string };
      }>('/api/school/students', {
        method: 'POST',
        body: JSON.stringify({
          name: student.name,
          dateOfBirth: student.dateOfBirth === '' ? null : student.dateOfBirth,
          gender: student.gender === '' ? null : (student.gender as Gender),
          bFormCnic: student.nationalId.number,
          idDocumentType:
            student.nationalId.number.trim() === ''
              ? null
              : student.nationalId.documentType,
          bloodGroup:
            student.bloodGroup === '' ? null : (student.bloodGroup as BloodGroup),
          nationality: student.nationality,
          religion: student.religion,
          previousSchool: student.previousSchool,
          medicalNotes: student.medicalNotes,
          guardians: guardians.map((guardian) => ({
            name: guardian.name,
            relationship: guardian.relationship,
            relationshipOther: guardian.relationshipOther,
            phone: guardian.phone,
            email: guardian.email,
            cnic: guardian.cnic,
            occupation: guardian.occupation,
            isPrimaryContact: guardian.isPrimaryContact,
          })),
          branchId: placement.branchId,
          gradeId: placement.gradeId,
          sectionId: placement.sectionId,
          academicYearId,
          rollNumber: placement.rollNumber,
          enrollmentDate: placement.enrollmentDate,
        }),
      });

      /*
       * The photo needs the student's id for its storage path, so it goes up
       * second. A failed upload must not undo an enrolment that has landed —
       * the photo can be added again from the profile page, and that judgement
       * is still correct.
       *
       * ── What was wrong, and what it cost ──────────────────────────────
       * This used to be `await fetch(...)` with **no `response.ok` check**,
       * inside a `catch` that logged to the console. A 413 (too large), a 415
       * (wrong type) and a 500 were all indistinguishable from success, and the
       * only person who could have noticed was looking at a profile page with
       * a blank avatar and no reason for it. *Student 5* on the live tenant has
       * `photo_url = null` to this day and nobody was ever told.
       *
       * `?photo=failed` carries the failure across the redirect so the profile
       * page can name it and offer the re-upload. It is a query flag rather
       * than state because the navigation is a real one — this component is
       * gone by the time the profile renders.
       */
      let photoProblem: string | null = null;

      if (photo !== null) {
        try {
          const form = new FormData();
          form.append('photo', photo);
          const response = await fetch(
            withSchoolParam(
              `/api/school/students/${created.student.studentProfileId}/photo`,
            ),
            { method: 'POST', body: form },
          );

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;

            photoProblem =
              payload?.error?.message ??
              `The photo could not be uploaded (HTTP ${response.status}).`;
          }
        } catch (caught) {
          photoProblem = schoolErrorMessage(
            caught,
            'The photo could not be uploaded.',
          );
        }
      }

      const destination = `/dashboard/admissions/students/${created.student.studentProfileId}`;
      router.push(
        photoProblem === null
          ? destination
          : `${destination}?photo=failed&reason=${encodeURIComponent(photoProblem)}`,
      );
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not enrol the student. Please try again.'));
      setIsSubmitting(false);
    }
  };

  const primaryGuardian =
    guardians.find((guardian) => guardian.isPrimaryContact) ?? guardians[0];

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="Enrolment steps">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              // Steps ahead of the current one are not reachable by clicking:
              // they depend on values the earlier steps have not validated yet.
              disabled={index > step || isSubmitting}
              onClick={() => {
                setStep(index);
              }}
              aria-current={index === step ? 'step' : undefined}
              className={
                index === step
                  ? 'rounded-full bg-brand-primary px-3 py-1 text-sm font-medium text-brand-onPrimary'
                  : index < step
                    ? 'rounded-full bg-brand-primary/10 px-3 py-1 text-sm font-medium text-brand-primary'
                    : 'rounded-full bg-surface-sunken px-3 py-1 text-sm font-medium text-ink-muted'
              }
            >
              {index + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Card header={<CardTitle title="Student information" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Full name"
                required
                value={student.name}
                disabled={isSubmitting}
                onChange={(event) => {
                  setStudentField('name', event.target.value);
                }}
              />
            </div>

            <Input
              label="Date of birth"
              type="date"
              value={student.dateOfBirth}
              disabled={isSubmitting}
              onChange={(event) => {
                setStudentField('dateOfBirth', event.target.value);
              }}
            />

            <Select
              label="Gender"
              placeholder="Select"
              options={GENDER_OPTIONS}
              value={student.gender}
              disabled={isSubmitting}
              onChange={(event) => {
                setStudentField('gender', event.target.value);
              }}
            />

            <NationalIdField
              value={student.nationalId}
              disabled={isSubmitting}
              onChange={(value) => {
                setStudentField('nationalId', value);
              }}
            />

            <Select
              label="Blood group"
              options={BLOOD_GROUP_OPTIONS}
              value={student.bloodGroup}
              disabled={isSubmitting}
              onChange={(event) => {
                setStudentField('bloodGroup', event.target.value);
              }}
            />

            <Select
              label="Nationality"
              options={NATIONALITY_OPTIONS}
              value={student.nationality}
              disabled={isSubmitting}
              onChange={(event) => {
                setStudentField('nationality', event.target.value);
              }}
            />

            <Select
              label="Religion"
              placeholder="Select"
              options={RELIGION_OPTIONS}
              value={student.religion}
              disabled={isSubmitting}
              onChange={(event) => {
                setStudentField('religion', event.target.value);
              }}
            />

            <div className="sm:col-span-2">
              <Input
                label="Previous school"
                value={student.previousSchool}
                disabled={isSubmitting}
                onChange={(event) => {
                  setStudentField('previousSchool', event.target.value);
                }}
              />
            </div>

            <div className="sm:col-span-2">
              <Textarea
                label="Medical notes"
                hint="Allergies, conditions or medication the school should know about."
                value={student.medicalNotes}
                disabled={isSubmitting}
                onChange={(event) => {
                  setStudentField('medicalNotes', event.target.value);
                }}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-ink">
                Photo
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={isSubmitting}
                className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-sunken file:px-3 file:py-2 file:text-sm file:font-medium"
                onChange={(event) => {
                  /*
                   * Only ever *sets*. Never nulls.
                   *
                   * This was `setPhoto(event.target.files?.[0] ?? null)`, and
                   * that is very likely the reported disappearance: cancelling
                   * a native file dialog fires `change` with an empty
                   * `FileList` on some platforms, and `?? null` read that as
                   * "the user removed the photo". Opening the picker, changing
                   * your mind and pressing Cancel silently discarded a
                   * selection made a minute earlier.
                   *
                   * Removing a photo is now one explicit button, below.
                   */
                  const file = event.target.files?.[0];
                  if (file !== undefined) setPhoto(file);
                }}
              />

              {photo === null ? (
                <p className="mt-1.5 text-sm text-ink-muted">
                  Optional. PNG, JPG or WebP, up to 2 MB. Uploaded once the
                  student record has been created.
                </p>
              ) : (
                <div className="mt-3 flex items-center gap-3">
                  {photoPreview === null ? null : (
                    // An object URL for a File the browser already holds.
                    // `next/image` cannot help: it would have to fetch and
                    // optimise a `blob:` URL that exists only in this tab.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photoPreview}
                      alt={`Selected photo: ${photo.name}`}
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                  )}

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {photo.name}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {(photo.size / 1024).toFixed(0)} KB · uploaded once the
                      student record has been created
                    </p>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      className="mt-1 text-xs font-medium text-status-danger-ink hover:underline"
                      onClick={() => {
                        setPhoto(null);
                      }}
                    >
                      Remove photo
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {step === 1 ? (
        <GuardianForm
          guardians={guardians}
          onChange={setGuardians}
          maxGuardians={maxGuardians}
          disabled={isSubmitting}
        />
      ) : null}

      {step === 2 ? (
        <Card header={<CardTitle title="Academic placement" />}>
          <AcademicPlacementForm
            branches={branches}
            academicYearId={academicYearId}
            academicYearName={academicYearName}
            value={placement}
            onChange={setPlacement}
            disabled={isSubmitting}
          />
        </Card>
      ) : null}

      {step === 3 ? (
        <Card header={<CardTitle title="Review and confirm" />}>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <ReviewItem label="Student" value={student.name} />
            <ReviewItem label="Student ID" value={studentIdPreview ?? 'Assigned on enrolment'} />
            <ReviewItem label="Date of birth" value={student.dateOfBirth} />
            <ReviewItem label="Gender" value={student.gender} />
            {/*
              Still masked here. The review step is read at the desk with the
              parent alongside, so revealing the number just because the form
              moved on would undo the point of hiding it on the step before.
            */}
            <ReviewItem
              label={
                student.nationalId.documentType === ''
                  ? 'Identity document'
                  : ID_DOCUMENT_TYPE_LABELS[student.nationalId.documentType]
              }
              value={maskNationalId(student.nationalId.number)}
            />
            <ReviewItem label="Blood group" value={student.bloodGroup} />
            <ReviewItem label="Nationality" value={student.nationality} />
            <ReviewItem label="Religion" value={student.religion} />
            <ReviewItem label="Previous school" value={student.previousSchool} />
            <ReviewItem label="Branch" value={branchName} />
            <ReviewItem label="Academic year" value={academicYearName} />
            <ReviewItem label="Roll number" value={placement.rollNumber} />
            <ReviewItem label="Enrolment date" value={placement.enrollmentDate} />
            <ReviewItem label="Photo" value={photo === null ? '' : photo.name} />
          </dl>

          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">Guardians</h3>
            <ul className="mt-2 space-y-1 text-sm text-ink-muted">
              {guardians.map((guardian, index) => (
                <li key={index}>
                  {guardian.name} ·{' '}
                  {guardian.relationship === 'other' &&
                  guardian.relationshipOther.trim() !== ''
                    ? guardian.relationshipOther
                    : GUARDIAN_RELATIONSHIP_LABELS[guardian.relationship]}{' '}
                  · {guardian.phone}
                  {/* Masked here for the same reason the student's is — the
                      review step is read at the desk with the parent alongside. */}
                  {guardian.cnic === '' ? '' : ` · ${maskNationalId(guardian.cnic)}`}
                  {guardian.isPrimaryContact ? ' · primary contact' : ''}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-5 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
            A GoHighLevel contact will be created for this student and for{' '}
            {primaryGuardian?.name === undefined || primaryGuardian.name === ''
              ? 'the primary guardian'
              : primaryGuardian.name}
            , and the admission welcome workflow will be triggered. If your GHL
            connection is unavailable the enrolment still completes, and you can
            re-run the sync from the student’s profile.
          </p>

          <p className="mt-2 text-xs text-ink-muted">
            The student ID shown above is a preview. The final number is issued
            when you submit, so it may differ if someone else enrols a student
            first.
          </p>
        </Card>
      ) : null}

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        {step > 0 ? (
          <Button
            variant="secondary"
            disabled={isSubmitting}
            onClick={() => {
              setStep((current) => Math.max(current - 1, 0));
            }}
          >
            Back
          </Button>
        ) : null}

        {step < STEPS.length - 1 ? (
          <Button onClick={goNext} disabled={isSubmitting}>
            Continue
          </Button>
        ) : (
          <Button
            isLoading={isSubmitting}
            onClick={() => {
              void submit();
            }}
          >
            Enrol student
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{value === '' ? '—' : value}</dd>
    </div>
  );
}
