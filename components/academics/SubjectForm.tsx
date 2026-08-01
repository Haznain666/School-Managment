'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { SUBJECT_COLORS } from '@/db/schema/subjects';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Creating and editing a subject.
 *
 * The colour is a palette rather than a picker. These eight are chosen to stay
 * distinguishable from one another in a grid of thirty-five cells — a free
 * picker invites two subjects a shade apart, which is exactly the mistake that
 * makes a timetable unreadable.
 */

export interface SubjectFormValues {
  id: string;
  name: string;
  code: string | null;
  color: string | null;
  isActive: boolean;
}

export interface SubjectFormProps {
  /** Null when creating. */
  subject?: SubjectFormValues | null;
}

export function SubjectForm({ subject = null }: SubjectFormProps) {
  const router = useRouter();

  const [name, setName] = useState(subject?.name ?? '');
  const [code, setCode] = useState(subject?.code ?? '');
  const [color, setColor] = useState<string>(subject?.color ?? SUBJECT_COLORS[0]);
  const [isActive, setIsActive] = useState(subject?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Give the subject a name.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const body = JSON.stringify({
      name: trimmed,
      code: code.trim(),
      color,
      ...(subject === null ? {} : { isActive }),
    });

    try {
      if (subject === null) {
        await schoolFetch('/api/school/subjects', { method: 'POST', body });
      } else {
        await schoolFetch(`/api/school/subjects/${subject.id}`, { method: 'PUT', body });
      }

      router.push('/dashboard/academics/subjects');
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the subject.'));
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="space-y-6"
      noValidate
    >
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Subject name"
            value={name}
            maxLength={80}
            placeholder="Mathematics"
            disabled={isSubmitting}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />

          <Input
            label="Short code"
            value={code}
            maxLength={12}
            placeholder="MATH"
            hint="Printed in the timetable grid, where the full name will not fit."
            disabled={isSubmitting}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />

          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 block text-sm font-medium text-slate-700">
              Colour
            </legend>

            <div className="flex flex-wrap gap-2">
              {SUBJECT_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={`Use colour ${option}`}
                  aria-pressed={color === option}
                  disabled={isSubmitting}
                  onClick={() => {
                    setColor(option);
                  }}
                  className={
                    color === option
                      ? 'h-9 w-9 rounded-full ring-2 ring-slate-900 ring-offset-2'
                      : 'h-9 w-9 rounded-full ring-1 ring-slate-300'
                  }
                  style={{ backgroundColor: option }}
                />
              ))}
            </div>

            <p className="mt-1.5 text-sm text-slate-500">
              How this subject appears in the weekly grid.
            </p>
          </fieldset>

          {subject === null ? null : (
            <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={isActive}
                disabled={isSubmitting}
                onChange={(event) => {
                  setIsActive(event.target.checked);
                }}
              />
              <span>
                Active
                <span className="block text-xs text-slate-500">
                  A retired subject stays on the timetables it already appears in
                  but cannot be added to new ones.
                </span>
              </span>
            </label>
          )}
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" isLoading={isSubmitting}>
          {subject === null ? 'Add subject' : 'Save changes'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isSubmitting}
          onClick={() => {
            router.push('/dashboard/academics/subjects');
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
