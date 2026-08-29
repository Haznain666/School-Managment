'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { CitySelect } from '@/components/super-admin/CitySelect';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { emailRejectionReason } from '@/lib/email-validation';
import {
  formatLandline,
  formatMobile,
  isValidLandline,
  isValidMobile,
  LANDLINE_HINT,
  LANDLINE_PLACEHOLDER,
  MOBILE_HINT,
  MOBILE_PLACEHOLDER,
} from '@/lib/phone-formats';
import { slugify } from '@/lib/slug';
import { deriveSchoolCode, schoolCodeRejectionReason } from '@/lib/school-code';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

export interface SchoolFormValues {
  id?: string;
  name: string;
  slug: string;
  /** Prefix for this school's student IDs, e.g. `GVS` -> `GVS-2025-0001`. */
  schoolCode: string;
  city: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  landline: string;
  phone: string;
  email: string;
  principalName: string;
}

export interface SchoolFormProps {
  /** Absent for create, present for edit. */
  initial?: SchoolFormValues;
  appDomain: string;
  /**
   * Called instead of navigating, when this form is step 1 of the wizard.
   *
   * The wizard needs the new school's id to run steps 2–5 against, and it must
   * not lose the page while doing so. Everything else about the form — the
   * validation, the payload, the endpoint — is identical either way, which is
   * the point: there is one school form in this product, not a wizard copy that
   * drifts from the edit screen.
   *
   * `needsAttention` carries the same judgement the standalone form acts on: a
   * school whose first administrator was not created, or was created and never
   * emailed, is recorded but not reachable. The wizard says so at the end
   * rather than silently landing on the overview.
   */
  onCreated?: (created: { schoolId: string; needsAttention: boolean }) => void;
  /** Overrides the submit button's label. */
  submitLabel?: string;
  /** Hides the Cancel button, for a host that provides its own navigation. */
  hideCancel?: boolean;
}

/**
 * The year shown in the example student ID, fixed at module load.
 *
 * Deliberately not computed during render — see the hint on the School Code
 * field below for what that cost.
 */
const EXAMPLE_ID_YEAR = new Date().getFullYear();

const EMPTY: SchoolFormValues = {
  name: '',
  slug: '',
  schoolCode: '',
  city: '',
  address: '',
  latitude: null,
  longitude: null,
  landline: '',
  phone: '',
  email: '',
  principalName: '',
};

type SlugState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available' }
  | { status: 'unavailable'; reason: string };

/**
 * Shared create/edit form for a school.
 *
 * ── The field order is the product owner's, and it is not arbitrary ──────
 * Head office name, street address, city, owner, landline, mobile, email,
 * subdomain, code. That is the order the information appears on a school's own
 * letterhead and on the form their office already fills in on paper, which is
 * what an operator is copying from. City used to come first, because on the
 * *branch* form choosing a city proposes the branch code; here it proposes
 * nothing, so leading with it asked the operator to answer a question about a
 * school they had not yet named.
 *
 * The two that are not on the letterhead — subdomain and code — sit at the
 * bottom together, because both are derived from the name by default and both
 * are platform concerns rather than school ones.
 */
export function SchoolForm({
  initial,
  appDomain,
  onCreated,
  submitLabel,
  hideCancel = false,
}: SchoolFormProps) {
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

      const codeProblem = schoolCodeRejectionReason(values.schoolCode.trim());
      if (codeProblem !== null) {
        setError(codeProblem);
        return;
      }

      if (!isValidLandline(values.landline)) {
        setError(`That landline is incomplete. ${LANDLINE_HINT}`);
        return;
      }

      if (!isValidMobile(values.phone)) {
        setError(`That mobile number is not in the accepted format. ${MOBILE_HINT}`);
        return;
      }

      const emailProblem = emailRejectionReason(values.email);
      if (emailProblem !== null) {
        setError(emailProblem);
        return;
      }

      // Every refusal above happens before this, and that ordering is the fix
      // for a real defect: the school-code check used to sit *after*
      // `setIsSubmitting(true)` and returned without clearing it, so a bad code
      // left the form disabled with its spinner running and no way back except
      // a page reload.
      setIsSubmitting(true);

      const payload = {
        name: values.name,
        slug: values.slug,
        schoolCode: values.schoolCode,
        city: values.city,
        address: values.address,
        latitude: values.latitude,
        longitude: values.longitude,
        landline: values.landline,
        phone: values.phone,
        email: values.email,
        principalName: values.principalName,
        // The Location ID is the tenant key and is fixed once a school exists.
      };

      try {
        if (isEdit && initial?.id !== undefined) {
          await superAdminFetch(`/api/super-admin/schools/${initial.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          router.push(`/super-admin/schools/${initial.id}`);
        } else {
          const created = await superAdminFetch<{
            school: { id: string };
            admin: { status: 'created' | 'exists' | 'skipped' };
            adminEmail: { queued: boolean; problem: string | null };
          }>('/api/super-admin/schools', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

          // A school nobody can sign in to is not provisioned, only recorded.
          // Two ways that happens, and both land on Users rather than the
          // overview: the number could not become an administrator, or one was
          // created but their password-setup email never made it into the
          // queue. Users is where the empty state offers to create somebody and
          // where "Send sign-in email" lives, so it is the screen that can
          // finish the job either way.
          const needsAttention =
            created.admin.status !== 'created' || !created.adminEmail.queued;

          if (onCreated !== undefined) {
            // The wizard owns the navigation from here. It also owns the
            // spinner: leaving `isSubmitting` set keeps the fields locked
            // while the next step mounts, so a second submit cannot create a
            // second school out of the same form.
            onCreated({ schoolId: created.school.id, needsAttention });
            return;
          }

          router.push(
            needsAttention
              ? `/super-admin/schools/${created.school.id}/users`
              : `/super-admin/schools/${created.school.id}`,
          );
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
    [values, isEdit, initial?.id, slugState, router, onCreated],
  );

  // Shows what the server will derive when the field is left blank, so the
  // operator can see the ID format before the school exists.
  const codePreview =
    values.schoolCode.trim() === ''
      ? deriveSchoolCode(values.name === '' ? 'School' : values.name)
      : values.schoolCode.trim();

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
          {/*
            1. Head Office Name. The one thing only the school can tell us, and
            the field every other default on this form is derived from — the
            subdomain tracks it, and the school code is proposed from it.
          */}
          <div className="sm:col-span-2">
            <Input
              label="Head Office Name"
              required
              value={values.name}
              onChange={(event) => {
                handleNameChange(event.target.value);
              }}
              disabled={isSubmitting}
              placeholder="Beaconhouse School System"
            />
          </div>

          {/* 2. Street Address. */}
          <div className="sm:col-span-2">
            <AddressAutocomplete
              label="Street Address"
              value={{
                address: values.address,
                latitude: values.latitude,
                longitude: values.longitude,
              }}
              onChange={(next) => {
                setValues((current) => ({
                  ...current,
                  address: next.address,
                  latitude: next.latitude,
                  longitude: next.longitude,
                }));
              }}
              disabled={isSubmitting}
            />
          </div>

          {/* 3. City. */}
          <CitySelect
            value={values.city}
            onChange={(city) => {
              setField('city', city);
            }}
            disabled={isSubmitting}
            required
          />

          {/*
            4. The person the platform holds responsible for this school.

            "Head of School" — Sprint 19a, item 1, and the same caption the
            school's own Settings screen now uses so the two cannot be read as
            different fields. It is deliberately not "Principal": a principal
            runs a *campus*, is assigned per branch on that branch's own page,
            and is a different fact about a different person that this field was
            being read as.

            On create it is also the name the school's first administrator
            account is opened under, which the hint below says. At a new school
            those are the same person; where they are not, the account is
            renamed from Users & Staff in one edit.
          */}
          <Input
            label="Head of School"
            value={values.principalName}
            onChange={(event) => {
              setField('principalName', event.target.value);
            }}
            disabled={isSubmitting}
            hint={
              isEdit
                ? undefined
                : 'Becomes the school’s first administrator, with the email below.'
            }
          />

          {/* 5 and 6. Both numbers, because a school office has both. */}
          <Input
            label="School Landline Number"
            type="tel"
            inputMode="numeric"
            value={values.landline}
            onChange={(event) => {
              setField('landline', formatLandline(event.target.value));
            }}
            disabled={isSubmitting}
            placeholder={LANDLINE_PLACEHOLDER}
            hint={LANDLINE_HINT}
            error={isValidLandline(values.landline) ? undefined : 'Incomplete landline number.'}
          />

          <Input
            label="School Mobile Number"
            type="tel"
            inputMode="numeric"
            value={values.phone}
            onChange={(event) => {
              setField('phone', formatMobile(event.target.value));
            }}
            disabled={isSubmitting}
            placeholder={MOBILE_PLACEHOLDER}
            hint={
              // Was: "this also becomes the principal's login, so use a mobile
              // that can receive WhatsApp". Both halves stopped being true at
              // Stage 4 — the login is the email address below, and no passcode
              // goes to a handset — so the form was telling operators to choose
              // this field carefully for a reason that no longer exists.
              MOBILE_HINT
            }
            error={isValidMobile(values.phone) ? undefined : 'Enter eleven digits, e.g. (0321) 123-4567.'}
          />

          {/* 7. The sign-in address, which is why the label says so. */}
          <div className="sm:col-span-2">
            <Input
              label="School Admin Email"
              type="email"
              value={values.email}
              onChange={(event) => {
                setField('email', event.target.value);
              }}
              disabled={isSubmitting}
              placeholder="office@school.edu.pk"
              hint={
                isEdit ? undefined : 'Becomes the first administrator’s sign-in address.'
              }
              error={emailRejectionReason(values.email) ?? undefined}
            />
          </div>

          {/* 8. Subdomain, and 9. the code — the two platform-side fields. */}
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
              <p className="mt-1 text-xs text-ink-muted">Checking availability…</p>
            ) : null}
            {slugState.status === 'available' && values.slug !== '' ? (
              <p className="mt-1 text-xs text-status-success-ink">Subdomain is available.</p>
            ) : null}
          </div>

          <Input
            label="School Code (for Student IDs)"
            value={values.schoolCode}
            onChange={(event) => {
              // Uppercased as it is typed: the code is stored and printed in
              // upper case, and showing it any other way invites a mismatch.
              setField('schoolCode', event.target.value.toUpperCase());
            }}
            disabled={isSubmitting}
            placeholder="e.g. GVS"
            maxLength={6}
            /*
              The year is read once at module load rather than during render.
              `new Date().getFullYear()` inside the hint is evaluated on the
              server and again in the browser, and those two run in different
              timezones — around New Year they disagree, and a differing text
              node is a hydration mismatch that throws away the server render
              of the whole form. An example student ID does not need to be
              correct to the second.
            */
            hint={`2–6 uppercase letters. Used to generate student IDs like ${
              codePreview
            }-${EXAMPLE_ID_YEAR}-0001.${
              values.schoolCode.trim() === '' ? ' Leave blank to derive it from the name.' : ''
            }`}
          />
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" isLoading={isSubmitting}>
          {submitLabel ?? (isEdit ? 'Save changes' : 'Create school')}
        </Button>
        {hideCancel ? null : (
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
        )}
      </div>
    </form>
  );
}
