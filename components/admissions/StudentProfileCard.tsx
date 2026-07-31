'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { BLOOD_GROUPS, GENDERS } from '@/db/schema/student-profiles';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

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

export function StudentProfileCard({ student, canEdit }: StudentProfileCardProps) {
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [values, setValues] = useState({
    dateOfBirth: student.dateOfBirth ?? '',
    gender: student.gender ?? '',
    bFormCnic: student.bFormCnic ?? '',
    bloodGroup: student.bloodGroup ?? '',
    nationality: student.nationality,
    religion: student.religion ?? '',
    previousSchool: student.previousSchool ?? '',
    medicalNotes: student.medicalNotes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const save = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);

    try {
      await schoolFetch(`/api/school/students/${student.studentProfileId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          dateOfBirth: values.dateOfBirth === '' ? null : values.dateOfBirth,
          gender: values.gender === '' ? null : values.gender,
          bFormCnic: values.bFormCnic,
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
              className="flex h-24 w-24 items-center justify-center rounded-xl bg-brand-primary text-2xl font-bold text-white"
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

          <p className="mt-3 font-mono text-xs text-slate-600">{student.studentId}</p>
          <Badge
            className="mt-2"
            variant={student.ghlContactId === null ? 'warning' : 'success'}
          >
            {student.ghlContactId === null ? 'Not in GHL' : 'Synced to GHL'}
          </Badge>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-slate-900">{student.name}</h3>

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
              <Input
                label="B-Form / CNIC"
                value={values.bFormCnic}
                disabled={isSaving}
                onChange={(event) => {
                  setValues((current) => ({ ...current, bFormCnic: event.target.value }));
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
              <Input
                label="Nationality"
                value={values.nationality}
                disabled={isSaving}
                onChange={(event) => {
                  setValues((current) => ({ ...current, nationality: event.target.value }));
                }}
              />
              <Input
                label="Religion"
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
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2"
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
              <Detail label="B-Form / CNIC" value={student.bFormCnic} />
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

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">
        {value === null || value === '' ? '—' : value}
      </dd>
    </div>
  );
}
