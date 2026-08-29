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
import { cn } from '@/lib/utils';
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
  /** Who administers this campus. See `lib/branch-leads.ts`. */
  branchAdmin: BranchLeadValues;
  /** Who heads this campus. Identical shape; writes an assignment as well. */
  branchPrincipal: BranchLeadValues;
}

/**
 * One of the two "who runs this campus" answers.
 *
 * `mode: 'none'` is the toggle switched off, which is the default for both and
 * is what every existing caller of this form posted before Sprint 19a. A form
 * that says nothing changes nothing.
 */
export interface BranchLeadValues {
  mode: 'none' | 'owner' | 'invite';
  fullName: string;
  phone: string;
  email: string;
}

const EMPTY_LEAD: BranchLeadValues = {
  mode: 'none',
  fullName: '',
  phone: '',
  email: '',
};

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
  branchAdmin: EMPTY_LEAD,
  branchPrincipal: EMPTY_LEAD,
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
 *
 * ── The one branch form in the product (Sprint 19a, item 3) ──────────────
 * Four screens render this component: the Super Admin wizard's step 2, the
 * Super Admin branch create and edit pages, and — new this sprint — the school
 * portal's own `/dashboard/branches/new` and `/dashboard/branches/[id]/edit`.
 * There is deliberately no second campus form anywhere, because the validation
 * behind it is one module (`lib/branch-leads.ts`) and a second form would be a
 * second set of rules to keep in step with it.
 *
 * ── Who runs this campus: two toggles, both off ──────────────────────────
 * A campus is a boundary, and a boundary with nobody inside it is a campus
 * whose staff cannot be invited, whose fees nobody can raise and whose
 * timetable nobody can build. Until this sprint the only answer the form could
 * give was "invite the branch email address", which produced an account called
 * "Johar Town Campus administrator" — a role, not a person.
 *
 * So there are two questions, each optional and each with the same shape:
 *
 *   **The school owner** — writes a scope row against the account that already
 *   exists. **No invitation, no password email**, and the form says so in one
 *   sentence, because an operator who is not told will go looking for the mail.
 *   Decision D3: one person, one login, many scopes.
 *
 *   **Somebody else** — full name, mobile and email, which mints the account
 *   and sends the password link. All three are required together and
 *   `lib/branch-leads.ts` refuses without them: `school_users.phone` is NOT
 *   NULL and unique per school, so there is no row to write without a number,
 *   and an account with no address is one nobody can ever sign in to.
 *
 * Both may be answered at once — a campus with an administrator *and* a head
 * is the normal case at a school group, not an edge one.
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

  const setLead = useCallback(
    (key: 'branchAdmin' | 'branchPrincipal', next: Partial<BranchLeadValues>) => {
      setValues((current) => ({ ...current, [key]: { ...current[key], ...next } }));
    },
    [],
  );

  /**
   * Why a lead cannot be saved yet, or null.
   *
   * Mirrors `readBranchLead` on the server rather than replacing it. The server
   * is the rule — §5aw records what happened the last time a route's validator
   * and its own form disagreed about a phone number — and this exists so the
   * operator is told before the round trip rather than after it.
   */
  const leadProblem = (lead: BranchLeadValues, hat: string): string | null => {
    if (lead.mode !== 'invite') return null;
    if (lead.fullName.trim() === '') return `Enter the ${hat}'s full name.`;
    if (!isValidMobile(lead.phone)) {
      return `Enter the ${hat}'s mobile number. ${MOBILE_HINT}`;
    }
    if (lead.email.trim() === '') {
      return `Enter the ${hat}'s email address — it is where the password link goes.`;
    }
    return emailRejectionReason(lead.email);
  };

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

      const adminProblem = leadProblem(values.branchAdmin, 'campus administrator');
      if (adminProblem !== null) {
        setError(adminProblem);
        return;
      }

      const principalProblem = leadProblem(values.branchPrincipal, 'campus principal');
      if (principalProblem !== null) {
        setError(principalProblem);
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
        /*
         * Only ever sent on create. Editing a campus must not silently mint a
         * member or re-grant a scope somebody has deliberately revoked, and
         * both routes ignore these fields on PATCH regardless — this is the
         * courtesy, the server is the rule.
         */
        branchAdmin: isEdit ? undefined : values.branchAdmin,
        branchPrincipal: isEdit ? undefined : values.branchPrincipal,
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
          const response = await fetch(
            isEdit && initial?.id !== undefined
              ? `/api/school/branches/${initial.id}`
              : '/api/school/branches',
            {
              method: isEdit && initial?.id !== undefined ? 'PATCH' : 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            },
          );

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

        router.push(
          doneUrl ??
            (isPlatform
              ? `/super-admin/schools/${schoolId}/branches`
              : '/dashboard/branches'),
        );
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
    [values, isEdit, initial?.id, schoolId, router, isPlatform, doneUrl, onSaved],
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
            Who runs this campus. Offered only on create — see the payload note
            above for why an edit never mints a member.

            It sits here, under the campus's own contact details, rather than at
            the foot of the form: the operator has just typed an address and a
            number for the campus, and the next question a school group asks
            itself is who answers them.
          */}
          {isEdit ? null : (
            <div className="space-y-4 sm:col-span-2">
              <BranchLeadFields
                title="Branch Administrator"
                hat="campus administrator"
                description="Runs this campus day to day: invites its staff, enrols its students and raises its vouchers."
                value={values.branchAdmin}
                disabled={isSubmitting}
                onChange={(next) => {
                  setLead('branchAdmin', next);
                }}
              />

              <BranchLeadFields
                title="Branch Principal"
                hat="campus principal"
                description="Heads this campus academically. Also given a principal assignment for it, which is what narrows what they see."
                value={values.branchPrincipal}
                disabled={isSubmitting}
                onChange={(next) => {
                  setLead('branchPrincipal', next);
                }}
              />
            </div>
          )}

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

/**
 * One "who runs this campus" question: a toggle, then a choice, then a person.
 *
 * Rendered twice with different copy rather than written twice, because the two
 * answers differ in exactly one place — the principal also gets an assignment —
 * and that difference is the server's, not this component's.
 *
 * ── The radio is not a dropdown ──────────────────────────────────────────
 * Two options, both of which change what is asked next. A `<select>` with two
 * entries hides the second answer behind a click and gives the reader nothing
 * to compare; the whole point here is that "the school owner" costs nothing and
 * "somebody else" sends an email to a real person, and an operator should be
 * able to see both sentences before choosing.
 */
function BranchLeadFields({
  title,
  hat,
  description,
  value,
  disabled,
  onChange,
}: {
  title: string;
  /** The role in the school's own words, for the field hints. */
  hat: string;
  description: string;
  value: BranchLeadValues;
  disabled: boolean;
  onChange: (next: Partial<BranchLeadValues>) => void;
}) {
  const on = value.mode !== 'none';

  const optionClass = (selected: boolean): string =>
    cn(
      'flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition',
      selected ? 'border-brand-primary bg-brand-primary/5' : 'border-line hover:border-line-strong',
      disabled && 'cursor-not-allowed opacity-60',
    );

  return (
    <div className="rounded-lg border border-line p-4">
      <Toggle
        label={title}
        description={description}
        checked={on}
        disabled={disabled}
        onChange={(next) => {
          // Switching off clears the answer rather than remembering it. A
          // half-typed invitation kept behind a closed toggle is an email
          // waiting to be sent by somebody who thinks they cancelled it.
          onChange(
            next
              ? { mode: 'owner' }
              : { mode: 'none', fullName: '', phone: '', email: '' },
          );
        }}
      />

      {on ? (
        <div className="mt-4 space-y-3">
          <label className={optionClass(value.mode === 'owner')}>
            <input
              type="radio"
              className="mt-0.5 h-4 w-4"
              name={`${title}-mode`}
              checked={value.mode === 'owner'}
              disabled={disabled}
              onChange={() => {
                onChange({ mode: 'owner' });
              }}
            />
            <span>
              <span className="font-medium text-ink">The school owner</span>
              <span className="mt-0.5 block text-ink-muted">
                They already have a login, so no invitation is sent and no
                password email goes out. This campus is simply added to what
                they can see.
              </span>
            </span>
          </label>

          <label className={optionClass(value.mode === 'invite')}>
            <input
              type="radio"
              className="mt-0.5 h-4 w-4"
              name={`${title}-mode`}
              checked={value.mode === 'invite'}
              disabled={disabled}
              onChange={() => {
                onChange({ mode: 'invite' });
              }}
            />
            <span>
              <span className="font-medium text-ink">Somebody else</span>
              <span className="mt-0.5 block text-ink-muted">
                Creates an account for them and emails a link to set their own
                password.
              </span>
            </span>
          </label>

          {value.mode === 'invite' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input
                  label="Full name"
                  required
                  value={value.fullName}
                  disabled={disabled}
                  placeholder="Ayesha Khan"
                  hint={`The ${hat}'s own name, not the campus's.`}
                  onChange={(event) => {
                    onChange({ fullName: event.target.value });
                  }}
                />
              </div>

              <Input
                label="Mobile Number"
                type="tel"
                inputMode="numeric"
                required
                value={value.phone}
                disabled={disabled}
                placeholder={MOBILE_PLACEHOLDER}
                hint={MOBILE_HINT}
                error={
                  value.phone === '' || isValidMobile(value.phone)
                    ? undefined
                    : 'Enter eleven digits, e.g. (0321) 123-4567.'
                }
                onChange={(event) => {
                  onChange({ phone: formatMobile(event.target.value) });
                }}
              />

              <Input
                label="Email"
                type="email"
                required
                value={value.email}
                disabled={disabled}
                placeholder="ayesha@school.edu.pk"
                hint="Where the password link is sent."
                error={emailRejectionReason(value.email) ?? undefined}
                onChange={(event) => {
                  onChange({ email: event.target.value });
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
