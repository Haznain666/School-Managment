'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { SubjectColorPicker } from '@/components/academics/SubjectColorPicker';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { SUBJECT_COLORS } from '@/db/schema/subjects';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Creating and editing a subject.
 *
 * The colour is the eight-swatch palette *and* a free picker — see
 * `SubjectColorPicker` for why both, and for what the picker does that a bare
 * `<input type="color">` does not. The palette is still first and still what a
 * school that does not care gets in one click; the mistake it guards against
 * (two subjects a shade apart) is now warned about rather than made
 * impossible, because a school with a house colour has a reason this product
 * has no standing to overrule.
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
  /**
   * The colours the school's other subjects already use.
   *
   * Passed in from the server page rather than fetched here: the list is small,
   * it is already loaded to render the subjects screen, and a colour picker
   * that makes its own request to warn about a clash would be spending a
   * ~1s round trip (§5aq) on advice.
   */
  otherSubjects?: ReadonlyArray<{ name: string; color: string | null }>;
}

export function SubjectForm({ subject = null, otherSubjects = [] }: SubjectFormProps) {
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

          <SubjectColorPicker
            value={color}
            onChange={setColor}
            disabled={isSubmitting}
            inUse={otherSubjects}
            previewLabel={code.trim() === '' ? name.trim().toUpperCase() : code.trim().toUpperCase()}
          />

          {subject === null ? null : (
            <label className="flex items-start gap-2 text-sm text-ink sm:col-span-2">
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
                <span className="block text-xs text-ink-muted">
                  A retired subject stays on the timetables it already appears in
                  but cannot be added to new ones.
                </span>
              </span>
            </label>
          )}
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
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
