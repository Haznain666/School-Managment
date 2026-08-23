'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, type FormEvent } from 'react';

import { CitySelect } from '@/components/super-admin/CitySelect';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import {
  CURRICULUM_LEVEL_DESCRIPTIONS,
  CURRICULUM_LEVEL_LABELS,
  CURRICULUM_LEVELS,
  type CurriculumLevel,
} from '@/db/schema';
import { classOptionsFor, sanitiseClassLevels } from '@/lib/branch-classes';
import { proposedBranchCode } from '@/lib/cities';
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
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

export interface BranchFormValues {
  id?: string;
  name: string;
  code: string;
  city: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  landline: string;
  phone: string;
  email: string;
  curriculumLevel: CurriculumLevel | '';
  /** Required only when `curriculumLevel` is `MIXED`. */
  boardName: string;
  classLevels: string[];
  isMainBranch: boolean;
  isActive: boolean;
  /** Create the branch email as this campus's administrator and invite them. */
  inviteAsBranchAdmin: boolean;
}

export interface BranchFormProps {
  /**
   * The school this campus belongs to, when the Super Admin panel is asking.
   *
   * Absent inside a school portal, where the tenant is not a parameter — it
   * comes from the session, and `/api/school/branches` derives it there. That
   * absence is what the whole `isPlatform` split below turns on: which endpoint
   * to call, where to go afterwards, and which two controls to offer, all of
   * which differ between an operator working across schools and an
   * administrator working inside their own.
   */
  schoolId?: string;
  /** Absent for create, present for edit. */
  initial?: BranchFormValues;
  /** Where to go once saved. Defaults to the panel's branch list. */
  doneUrl?: string;
  /**
   * Called instead of navigating, when this form is step 2 of the wizard.
   *
   * Takes precedence over `doneUrl`. The wizard has three more steps to run and
   * cannot afford to leave the page to report a success.
   */
  onSaved?: () => void;
  /** Overrides the submit button's label. */
  submitLabel?: string;
  /** Hides the Cancel button, for a host that provides its own navigation. */
  hideCancel?: boolean;
}

const EMPTY: BranchFormValues = {
  name: '',
  code: '',
  city: '',
  address: '',
  latitude: null,
  longitude: null,
  landline: '',
  phone: '',
  email: '',
  curriculumLevel: '',
  boardName: '',
  classLevels: [],
  isMainBranch: false,
  isActive: true,
  inviteAsBranchAdmin: false,
};

const CURRICULUM_OPTIONS = CURRICULUM_LEVELS.map((level) => ({
  value: level,
  label: CURRICULUM_LEVEL_LABELS[level],
}));

/**
 * Create/edit a campus.
 *
 * ── Why the fields are in this order ─────────────────────────────────────
 * City, then name, then code. The city is asked first because it is the only
 * answer that *produces* another: choosing Karachi proposes `KHI-MAIN` as the
 * code, so an operator who works top-to-bottom finds the third field already
 * filled in. Asked in any other order the proposal arrives after the operator
 * has typed over it, which is worse than not proposing at all.
 *
 * The name sits between them and stays empty on purpose. It is the one thing
 * only the school knows — "Johar Town Campus" is not derivable from anything —
 * so guessing at it would produce a name nobody uses and which everybody would
 * have to clear.
 *
 * ── What the curriculum controls ─────────────────────────────────────────
 * Two fields below it, which is why it is asked before either. `MIXED` reveals
 * the board-name field, because "mixed" alone cannot be printed on a
 * certificate. And the class list is filtered by it — a Matric campus is
 * offered Grade 9 and Grade 10, a Cambridge one O1/O2/O3 — so changing the
 * curriculum re-filters what is already ticked rather than silently keeping
 * rungs the new curriculum does not have.
 */
export function BranchForm({
  schoolId,
  initial,
  doneUrl,
  onSaved,
  submitLabel,
  hideCancel = false,
}: BranchFormProps) {
  const router = useRouter();
  const isEdit = initial?.id !== undefined;

  /** True in the Super Admin panel, false inside a school's own portal. */
  const isPlatform = schoolId !== undefined;

  const [values, setValues] = useState<BranchFormValues>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * The code follows the city until the operator edits it, then stops. Same
   * rule the school form's subdomain follows, and for the same reason: a
   * deliberate code must not be overwritten by a later change of city.
   *
   * Always manual when editing — an existing branch's code is in use, and
   * re-proposing over it would rename a campus that people already reference.
   */
  const codeIsManual = useRef(isEdit);

  const setField = useCallback(
    <K extends keyof BranchFormValues>(key: K, value: BranchFormValues[K]) => {
      setValues((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const handleCityChange = useCallback((city: string) => {
    setValues((current) => ({
      ...current,
      city,
      code: codeIsManual.current ? current.code : proposedBranchCode(city),
    }));
  }, []);

  const handleCurriculumChange = useCallback((level: CurriculumLevel) => {
    setValues((current) => ({
      ...current,
      curriculumLevel: level,
      // Drop the rungs the new curriculum does not have. Keeping them would
      // save a campus as teaching classes its own board does not run.
      classLevels: sanitiseClassLevels(current.classLevels, level),
      // The board name means nothing off MIXED, and leaving a stale one behind
      // would save it the next time the operator switched back.
      boardName: level === 'MIXED' ? current.boardName : '',
    }));
  }, []);

  /**
   * Both an address and a mobile are required to invite anyone.
   * `school_users.phone` is NOT NULL and unique per school — it is how a member
   * is identified within a tenant — so an email alone cannot produce a row.
   */
  const canInvite =
    values.email.trim() !== '' &&
    emailRejectionReason(values.email) === null &&
    isValidMobile(values.phone) &&
    values.phone.trim() !== '';

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if (values.curriculumLevel === '') {
        setError('Select a curriculum level.');
        return;
      }

      if (values.curriculumLevel === 'MIXED' && values.boardName.trim() === '') {
        setError('Name the board this campus follows.');
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

      setIsSubmitting(true);

      const payload = {
        name: values.name,
        code: values.code,
        city: values.city,
        address: values.address,
        latitude: values.latitude,
        longitude: values.longitude,
        landline: values.landline,
        phone: values.phone,
        email: values.email,
        curriculumLevel: values.curriculumLevel,
        boardName: values.boardName,
        classLevels: values.classLevels,
        isMainBranch: values.isMainBranch,
        isActive: values.isActive,
        // Only ever meaningful on create, in the panel, and only when there is
        // somebody to invite. Editing a branch must not silently mint a member,
        // and the school-side route ignores this field outright.
        inviteAsBranchAdmin:
          isPlatform && !isEdit && canInvite && values.inviteAsBranchAdmin,
      };

      try {
        if (isPlatform) {
          const base = `/api/super-admin/schools/${schoolId}/branches`;

          await superAdminFetch(
            isEdit && initial?.id !== undefined ? `${base}/${initial.id}` : base,
            {
              method: isEdit && initial?.id !== undefined ? 'PATCH' : 'POST',
              body: JSON.stringify(payload),
            },
          );
        } else {
          // Not `superAdminFetch`: its 401 handler sends the browser to
          // /super-admin/login, which is the last place a school administrator
          // should land when their own session lapses.
          const response = await fetch('/api/school/branches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          const result = (await response.json()) as {
            ok?: boolean;
            error?: { message?: string };
          };

          if (!response.ok || result.ok !== true) {
            setError(result.error?.message ?? 'Could not save the branch.');
            setIsSubmitting(false);
            return;
          }
        }

        if (onSaved !== undefined) {
          // The wizard owns what happens next, and keeps the form disabled
          // while it moves on so a second submit cannot create a second branch.
          onSaved();
          return;
        }

        router.push(doneUrl ?? `/super-admin/schools/${schoolId}/branches`);
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
    [
      values,
      isEdit,
      initial?.id,
      schoolId,
      router,
      canInvite,
      isPlatform,
      doneUrl,
      onSaved,
    ],
  );

  const curriculumHint =
    values.curriculumLevel === ''
      ? undefined
      : CURRICULUM_LEVEL_DESCRIPTIONS[values.curriculumLevel];

  const classOptions =
    values.curriculumLevel === '' ? [] : classOptionsFor(values.curriculumLevel);

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
            1. Main branch, first.

            It is the only answer on this form that changes another record — it
            clears whichever campus currently holds the flag — and it is the one
            an operator knows before they know anything else, because the first
            campus they enter is almost always the main one. Asked last, as it
            used to be, it was routinely missed on exactly that campus.
          */}
          <div className="sm:col-span-2">
            <Toggle
              label="Main Branch"
              description="Only one branch per school can be the main one. Setting this clears the current holder."
              checked={values.isMainBranch}
              disabled={isSubmitting}
              onChange={(next) => {
                setField('isMainBranch', next);
              }}
            />
          </div>

          {/* 2. What the school calls this campus. Nothing derives it. */}
          <div className="sm:col-span-2">
            <Input
              label="Branch Name"
              required
              value={values.name}
              onChange={(event) => {
                setField('name', event.target.value);
              }}
              disabled={isSubmitting}
              placeholder="Johar Town Campus"
              hint="What the school calls this campus."
            />
          </div>

          {/* 3. Street Address. */}
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

          {/*
            4. City, and the branch code it proposes, side by side.

            The city is still asked immediately before the code for the reason
            it used to be asked first: choosing Karachi fills the field to its
            right with `KHI-MAIN`, and a proposal that arrives after the operator
            has typed over it is worse than no proposal at all.
          */}
          <CitySelect
            value={values.city}
            onChange={handleCityChange}
            disabled={isSubmitting}
            required
          />

          <Input
            label="Branch code"
            required
            value={values.code}
            onChange={(event) => {
              codeIsManual.current = true;
              setField('code', event.target.value.toUpperCase());
            }}
            disabled={isSubmitting}
            hint={
              values.city === ''
                ? 'Unique within this school. Choose a city and one is proposed.'
                : `Proposed from ${values.city}. Unique within this school — edit it freely.`
            }
            placeholder="KHI-MAIN"
          />

          {/* 5 and 6. */}
          <Input
            label="Branch Landline Number"
            type="tel"
            inputMode="numeric"
            value={values.landline}
            onChange={(event) => {
              // Reformatted on every keystroke, so the operator never has to be
              // told where the brackets go.
              setField('landline', formatLandline(event.target.value));
            }}
            disabled={isSubmitting}
            placeholder={LANDLINE_PLACEHOLDER}
            hint={LANDLINE_HINT}
            error={isValidLandline(values.landline) ? undefined : 'Incomplete landline number.'}
          />

          <Input
            label="Branch Mobile Number"
            type="tel"
            inputMode="numeric"
            value={values.phone}
            onChange={(event) => {
              setField('phone', formatMobile(event.target.value));
            }}
            disabled={isSubmitting}
            placeholder={MOBILE_PLACEHOLDER}
            hint={MOBILE_HINT}
            error={isValidMobile(values.phone) ? undefined : 'Enter eleven digits, e.g. (0321) 123-4567.'}
          />

          {/* 7. */}
          <div className="sm:col-span-2">
            <Input
              label="Branch Email"
              type="email"
              value={values.email}
              onChange={(event) => {
                setField('email', event.target.value);
              }}
              disabled={isSubmitting}
              placeholder="campus@school.edu.pk"
              error={emailRejectionReason(values.email) ?? undefined}
            />
          </div>

          {/*
            Offered only on create, and only once there is an email to attach it
            to. An email typed here used to go nowhere at all, which is what
            "the email is not being sent to the user" meant. It sits directly
            under the address it acts on rather than at the foot of the form.
          */}
          {isPlatform && !isEdit && values.email.trim() !== '' ? (
            <div className="sm:col-span-2">
              <Toggle
                label="Invite this email as the branch administrator"
                description={
                  canInvite
                    ? `${values.email.trim()} will be given a branch administrator account for this campus and emailed a link to set their password.`
                    : 'A mobile number is needed as well — it is how a member is identified within a school. Add one above to enable this.'
                }
                checked={canInvite && values.inviteAsBranchAdmin}
                disabled={isSubmitting || !canInvite}
                onChange={(next) => {
                  setField('inviteAsBranchAdmin', next);
                }}
              />
            </div>
          ) : null}

          {/* 8. Curriculum level — it decides what 9 may contain. */}
          <div className="sm:col-span-2">
            <Select
              label="Curriculum Level"
              options={CURRICULUM_OPTIONS}
              placeholder="Select a curriculum"
              required
              value={values.curriculumLevel}
              disabled={isSubmitting}
              hint={curriculumHint}
              onChange={(event) => {
                handleCurriculumChange(event.target.value as CurriculumLevel);
              }}
            />
          </div>

          {/*
            Only for MIXED. The other three levels name their own board, so
            asking would be asking a question with one possible answer.
          */}
          {values.curriculumLevel === 'MIXED' ? (
            <div className="sm:col-span-2">
              <Input
                label="Board name"
                required
                value={values.boardName}
                onChange={(event) => {
                  setField('boardName', event.target.value);
                }}
                disabled={isSubmitting}
                placeholder="Aga Khan Board and Cambridge"
                hint="Which boards this campus follows. “Mixed” on its own cannot be printed on a certificate."
              />
            </div>
          ) : null}

          {/* 9. */}
          <div className="sm:col-span-2">
            <MultiSelect
              label="Classes Taught"
              options={classOptions}
              value={values.classLevels}
              onChange={(next) => {
                setField('classLevels', next);
              }}
              disabled={isSubmitting}
              emptyMessage="Choose a curriculum level first — it decides which classes this campus can offer."
              hint="Tick every class this campus runs. A junior campus ticks only its own range."
            />
          </div>

          {/*
            Deactivating is an operator's control, not a school's. Inside the
            portal an inactive branch is simply invisible — it disappears from
            every picker, including this form's own school's — so a school
            administrator who switched it off would have hidden a campus with
            no screen left that shows it again.

            No principal field anywhere on this form, and that is deliberate:
            principals are assigned per campus in School Admin → Settings, where
            `components/school/PrincipalAssignments.tsx` already handles the
            single- and multiple-principal models. A second place to type a
            principal's name would be a second answer to the same question.
          */}
          {isPlatform ? (
            <div className="sm:col-span-2">
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
          ) : null}
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" isLoading={isSubmitting}>
          {submitLabel ?? (isEdit ? 'Save changes' : 'Create branch')}
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
