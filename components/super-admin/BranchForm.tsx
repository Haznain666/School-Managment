'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { CitySelect } from '@/components/super-admin/CitySelect';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import {
  CURRICULUM_LEVEL_DESCRIPTIONS,
  CURRICULUM_LEVEL_LABELS,
  CURRICULUM_LEVELS,
  type CurriculumLevel,
} from '@/db/schema';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

export interface BranchFormValues {
  id?: string;
  name: string;
  code: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  curriculumLevel: CurriculumLevel | '';
  maxGrade: string;
  isMainBranch: boolean;
  isActive: boolean;
}

export interface BranchFormProps {
  schoolId: string;
  /** Absent for create, present for edit. */
  initial?: BranchFormValues;
}

const EMPTY: BranchFormValues = {
  name: '',
  code: '',
  city: '',
  address: '',
  phone: '',
  email: '',
  curriculumLevel: '',
  maxGrade: '',
  isMainBranch: false,
  isActive: true,
};

const CURRICULUM_OPTIONS = CURRICULUM_LEVELS.map((level) => ({
  value: level,
  label: CURRICULUM_LEVEL_LABELS[level],
}));

export function BranchForm({ schoolId, initial }: BranchFormProps) {
  const router = useRouter();
  const isEdit = initial?.id !== undefined;

  const [values, setValues] = useState<BranchFormValues>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setField = useCallback(
    <K extends keyof BranchFormValues>(key: K, value: BranchFormValues[K]) => {
      setValues((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if (values.curriculumLevel === '') {
        setError('Select a curriculum level.');
        return;
      }

      setIsSubmitting(true);

      const payload = {
        name: values.name,
        code: values.code,
        city: values.city,
        address: values.address,
        phone: values.phone,
        email: values.email,
        curriculumLevel: values.curriculumLevel,
        maxGrade: values.maxGrade,
        isMainBranch: values.isMainBranch,
        isActive: values.isActive,
      };

      const base = `/api/super-admin/schools/${schoolId}/branches`;

      try {
        if (isEdit && initial?.id !== undefined) {
          await superAdminFetch(`${base}/${initial.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
        } else {
          await superAdminFetch(base, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        }

        router.push(`/super-admin/schools/${schoolId}/branches`);
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not save the branch. Please try again.',
        );
        setIsSubmitting(false);
      }
    },
    [values, isEdit, initial?.id, schoolId, router],
  );

  const curriculumHint =
    values.curriculumLevel === ''
      ? undefined
      : CURRICULUM_LEVEL_DESCRIPTIONS[values.curriculumLevel];

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-6"
      noValidate
    >
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Branch name"
            required
            value={values.name}
            onChange={(event) => {
              setField('name', event.target.value);
            }}
            disabled={isSubmitting}
            placeholder="Karachi Main Campus"
          />

          <Input
            label="Branch code"
            required
            value={values.code}
            onChange={(event) => {
              setField('code', event.target.value.toUpperCase());
            }}
            disabled={isSubmitting}
            hint="Unique within this school, e.g. KHI-MAIN"
            placeholder="KHI-MAIN"
          />

          <CitySelect
            value={values.city}
            onChange={(city) => {
              setField('city', city);
            }}
            disabled={isSubmitting}
            required
          />

          <Select
            label="Curriculum level"
            options={CURRICULUM_OPTIONS}
            placeholder="Select a curriculum"
            required
            value={values.curriculumLevel}
            disabled={isSubmitting}
            hint={curriculumHint}
            onChange={(event) => {
              setField('curriculumLevel', event.target.value as CurriculumLevel);
            }}
          />

          <Input
            label="Highest grade"
            value={values.maxGrade}
            onChange={(event) => {
              setField('maxGrade', event.target.value);
            }}
            disabled={isSubmitting}
            placeholder="Grade 10 / O2 / A2"
          />

          <Input
            label="Phone"
            type="tel"
            value={values.phone}
            onChange={(event) => {
              setField('phone', event.target.value);
            }}
            disabled={isSubmitting}
          />

          <Input
            label="Email"
            type="email"
            value={values.email}
            onChange={(event) => {
              setField('email', event.target.value);
            }}
            disabled={isSubmitting}
          />

          <div className="sm:col-span-2">
            <Input
              label="Address"
              value={values.address}
              onChange={(event) => {
                setField('address', event.target.value);
              }}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-3 sm:col-span-2">
            <Toggle
              label="Main branch"
              description="Only one branch per school can be the main one. Setting this clears the current holder."
              checked={values.isMainBranch}
              disabled={isSubmitting}
              onChange={(next) => {
                setField('isMainBranch', next);
              }}
            />

            <Toggle
              label="Active"
              description="Inactive branches stay on record but are hidden from the school portal."
              checked={values.isActive}
              disabled={isSubmitting}
              onChange={(next) => {
                setField('isActive', next);
              }}
            />
          </div>
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" isLoading={isSubmitting}>
          {isEdit ? 'Save changes' : 'Create branch'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isSubmitting}
          onClick={() => {
            router.back();
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
