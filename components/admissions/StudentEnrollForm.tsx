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
  GuardianForm,
  type GuardianDraft,
} from '@/components/admissions/GuardianForm';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { BLOOD_GROUPS, GENDERS, type BloodGroup, type Gender } from '@/db/schema/student-profiles';
import { GUARDIAN_RELATIONSHIP_LABELS } from '@/db/schema/student-guardians';
import { isValidPhone } from '@/lib/phone';
import { schoolErrorMessage, schoolFetch, withSchoolParam } from '@/lib/school-client';

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

interface StudentDraft {
  name: string;
  dateOfBirth: string;
  gender: string;
  bFormCnic: string;
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
    bFormCnic: '',
    bloodGroup: '',
    nationality: 'Pakistani',
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
        relationship:
          prefill.guardianRelationship !== undefined &&
          prefill.guardianRelationship in GUARDIAN_RELATIONSHIP_LABELS
            ? (prefill.guardianRelationship as GuardianDraft['relationship'])
            : 'guardian',
        phone: prefill.guardianPhone ?? '',
        email: prefill.guardianEmail ?? '',
        cnic: prefill.guardianCnic ?? '',
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
      return student.name.trim() === '' ? 'Enter the student’s full name.' : null;
    }

    if (index === 1) {
      for (const [position, guardian] of guardians.entries()) {
        if (guardian.name.trim() === '') {
          return `Guardian ${position + 1} needs a full name.`;
        }
        if (!isValidPhone(guardian.phone)) {
          return `Guardian ${position + 1} needs a valid Pakistani mobile number.`;
        }
      }
      return null;
    }

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
          bFormCnic: student.bFormCnic,
          bloodGroup:
            student.bloodGroup === '' ? null : (student.bloodGroup as BloodGroup),
          nationality: student.nationality,
          religion: student.religion,
          previousSchool: student.previousSchool,
          medicalNotes: student.medicalNotes,
          guardians: guardians.map((guardian) => ({
            name: guardian.name,
            relationship: guardian.relationship,
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

      // The photo needs the student's id for its storage path, so it goes up
      // second. A failed upload must not undo an enrolment that has landed —
      // the photo can be added again from the profile page.
      if (photo !== null) {
        try {
          const form = new FormData();
          form.append('photo', photo);
          await fetch(
            withSchoolParam(
              `/api/school/students/${created.student.studentProfileId}/photo`,
            ),
            { method: 'POST', body: form },
          );
        } catch (caught) {
          console.warn('[enrol] photo upload failed:', caught);
        }
      }

      router.push(`/dashboard/admissions/students/${created.student.studentProfileId}`);
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
                  ? 'rounded-full bg-brand-primary px-3 py-1 text-sm font-medium text-white'
                  : index < step
                    ? 'rounded-full bg-brand-primary/10 px-3 py-1 text-sm font-medium text-brand-primary'
                    : 'rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-400'
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

            <Input
              label="B-Form / CNIC"
              placeholder="42101-1234567-1"
              value={student.bFormCnic}
              disabled={isSubmitting}
              onChange={(event) => {
                setStudentField('bFormCnic', event.target.value);
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

            <Input
              label="Nationality"
              value={student.nationality}
              disabled={isSubmitting}
              onChange={(event) => {
                setStudentField('nationality', event.target.value);
              }}
            />

            <Input
              label="Religion"
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
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Photo
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={isSubmitting}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
                onChange={(event) => {
                  setPhoto(event.target.files?.[0] ?? null);
                }}
              />
              <p className="mt-1.5 text-sm text-slate-500">
                Optional. PNG, JPG or WebP, up to 2 MB. Uploaded once the student
                record has been created.
              </p>
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
            <ReviewItem label="B-Form / CNIC" value={student.bFormCnic} />
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

          <div className="mt-5 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Guardians</h3>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {guardians.map((guardian, index) => (
                <li key={index}>
                  {guardian.name} · {GUARDIAN_RELATIONSHIP_LABELS[guardian.relationship]}{' '}
                  · {guardian.phone}
                  {guardian.isPrimaryContact ? ' · primary contact' : ''}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            A GoHighLevel contact will be created for this student and for{' '}
            {primaryGuardian?.name === undefined || primaryGuardian.name === ''
              ? 'the primary guardian'
              : primaryGuardian.name}
            , and the admission welcome workflow will be triggered. If your GHL
            connection is unavailable the enrolment still completes, and you can
            re-run the sync from the student’s profile.
          </p>

          <p className="mt-2 text-xs text-slate-500">
            The student ID shown above is a preview. The final number is issued
            when you submit, so it may differ if someone else enrols a student
            first.
          </p>
        </Card>
      ) : null}

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
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
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value === '' ? '—' : value}</dd>
    </div>
  );
}
