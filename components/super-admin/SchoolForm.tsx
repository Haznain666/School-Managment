'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { CitySelect } from '@/components/super-admin/CitySelect';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { slugify } from '@/lib/slug';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

export interface SchoolFormValues {
  id?: string;
  name: string;
  slug: string;
  locationId: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  principalName: string;
}

export interface SchoolFormProps {
  /** Absent for create, present for edit. */
  initial?: SchoolFormValues;
  appDomain: string;
}

const EMPTY: SchoolFormValues = {
  name: '',
  slug: '',
  locationId: '',
  city: '',
  address: '',
  phone: '',
  email: '',
  principalName: '',
};

type SlugState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available' }
  | { status: 'unavailable'; reason: string };

/** Shared create/edit form for a school. */
export function SchoolForm({ initial, appDomain }: SchoolFormProps) {
  const router = useRouter();
  const isEdit = initial?.id !== undefined;

  const [values, setValues] = useState<SchoolFormValues>(initial ?? EMPTY);
  const [slugState, setSlugState] = useState<SlugState>({ status: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * The slug follows the name until the operator edits it directly, at which
   * point it stops tracking — otherwise a deliberate slug would be silently
   * overwritten by the next keystroke in the name field.
   */
  const slugIsManual = useRef(isEdit);

  const setField = useCallback(
    <K extends keyof SchoolFormValues>(key: K, value: SchoolFormValues[K]) => {
      setValues((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const handleNameChange = useCallback((name: string) => {
    setValues((current) => ({
      ...current,
      name,
      slug: slugIsManual.current ? current.slug : slugify(name),
    }));
  }, []);

  // Debounced availability check. The abort controller drops responses from
  // superseded keystrokes so a slow early request cannot overwrite a later one.
  useEffect(() => {
    const slug = values.slug.trim();

    if (slug === '') {
      setSlugState({ status: 'idle' });
      return;
    }

    if (isEdit && slug === initial?.slug) {
      setSlugState({ status: 'available' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSlugState({ status: 'checking' });

      const query = new URLSearchParams({ slug });
      if (initial?.id !== undefined) query.set('excludeSchoolId', initial.id);

      void superAdminFetch<{ available: boolean; reason: string | null }>(
        `/api/super-admin/schools/check-slug?${query.toString()}`,
        { signal: controller.signal },
      )
        .then((result) => {
          setSlugState(
            result.available
              ? { status: 'available' }
              : {
                  status: 'unavailable',
                  reason: result.reason ?? 'That subdomain is not available.',
                },
          );
        })
        .catch(() => {
          // A failed check must not block submission; the server validates again.
          setSlugState({ status: 'idle' });
        });
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [values.slug, isEdit, initial?.slug, initial?.id]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if (slugState.status === 'unavailable') {
        setError(slugState.reason);
        return;
      }

      setIsSubmitting(true);

      const payload = {
        name: values.name,
        slug: values.slug,
        city: values.city,
        address: values.address,
        phone: values.phone,
        email: values.email,
        principalName: values.principalName,
        // The Location ID is the tenant key and is fixed once a school exists.
        ...(isEdit ? {} : { locationId: values.locationId }),
      };

      try {
        if (isEdit && initial?.id !== undefined) {
          await superAdminFetch(`/api/super-admin/schools/${initial.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          router.push(`/super-admin/schools/${initial.id}`);
        } else {
          const created = await superAdminFetch<{ school: { id: string } }>(
            '/api/super-admin/schools',
            { method: 'POST', body: JSON.stringify(payload) },
          );
          router.push(`/super-admin/schools/${created.school.id}`);
        }
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not save the school. Please try again.',
        );
        setIsSubmitting(false);
      }
    },
    [values, isEdit, initial?.id, slugState, router],
  );

  const slugHint =
    values.slug === ''
      ? `The school portal will live at <subdomain>.${appDomain}`
      : `Portal: ${values.slug}.${appDomain}`;

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
          <div className="sm:col-span-2">
            <Input
              label="School name"
              required
              value={values.name}
              onChange={(event) => {
                handleNameChange(event.target.value);
              }}
              disabled={isSubmitting}
              placeholder="Beaconhouse School System"
            />
          </div>

          <div className="sm:col-span-2">
            <Input
              label="Subdomain"
              required
              value={values.slug}
              onChange={(event) => {
                slugIsManual.current = true;
                setField('slug', event.target.value.toLowerCase());
              }}
              disabled={isSubmitting}
              hint={slugState.status === 'unavailable' ? undefined : slugHint}
              error={
                slugState.status === 'unavailable' ? slugState.reason : undefined
              }
              placeholder="beaconhouse"
            />
            {slugState.status === 'checking' ? (
              <p className="mt-1 text-xs text-slate-500">Checking availability…</p>
            ) : null}
            {slugState.status === 'available' && values.slug !== '' ? (
              <p className="mt-1 text-xs text-emerald-600">Subdomain is available.</p>
            ) : null}
          </div>

          <Input
            label="GHL Location ID"
            required={!isEdit}
            value={values.locationId}
            onChange={(event) => {
              setField('locationId', event.target.value);
            }}
            disabled={isSubmitting || isEdit}
            hint={
              isEdit
                ? 'Fixed after creation — it is the tenant key for all of this school’s data.'
                : 'The GoHighLevel sub-account ID for this school.'
            }
          />

          <CitySelect
            value={values.city}
            onChange={(city) => {
              setField('city', city);
            }}
            disabled={isSubmitting}
            required
          />

          <Input
            label="Principal name"
            value={values.principalName}
            onChange={(event) => {
              setField('principalName', event.target.value);
            }}
            disabled={isSubmitting}
          />

          <Input
            label="Phone"
            type="tel"
            value={values.phone}
            onChange={(event) => {
              setField('phone', event.target.value);
            }}
            disabled={isSubmitting}
            placeholder="+92 21 1234567"
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
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" isLoading={isSubmitting}>
          {isEdit ? 'Save changes' : 'Create school'}
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
