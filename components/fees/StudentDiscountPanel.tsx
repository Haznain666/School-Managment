'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import {
  SCHEME_TYPES,
  SCHEME_TYPE_LABELS,
  type SchemeType,
} from '@/db/schema/concession-schemes';
import { formatPkr } from '@/lib/money';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Apply a discount to a child — Sprint 20, item 7.
 *
 * ── One component, two screens (decision D3) ─────────────────────────────
 * The requirement says discounts are chosen *while enrolling*, and that the
 * operator may remove or apply others afterwards. Those are the wizard and the
 * profile, and they must not answer "does this child have a sibling here"
 * differently — so both render this, and both ask
 * `/api/school/fees/student-discounts`, which resolves the family through the
 * same CNIC-or-phone rule as everything else.
 *
 * The two modes differ in exactly one way. On the **profile** the panel writes:
 * applying grants immediately and removing closes immediately, because there is
 * a child to grant against. In the **wizard** there is no child yet, so the
 * selection is lifted to the caller and travels with the enrolment — which is
 * also why the wizard's step is entirely skippable. An admissions desk with a
 * queue in front of it must never be held up by a discount decision, and there
 * is nothing here that can fail validation.
 *
 * ── Three states, and each says something different (item 7b) ────────────
 *  1. the child qualifies for a sibling discount and nobody has applied one —
 *     name the sibling and offer the button;
 *  2. discounts are applied — one chip per grant, naming the scheme and its
 *     rate, each removable, plus the button to add another;
 *  3. neither — the button alone, with the scholarship and other schemes
 *     behind it.
 *
 * ── At most one of each type (item 7c) ───────────────────────────────────
 * The modal is a **radio group per section**, not a checkbox list. Selecting a
 * second scholarship replaces the first in the selection rather than stacking
 * on it, because two scholarships on one child is a school that has decided
 * twice and a voucher whose discount nobody can explain.
 *
 * The **Sibling Discount section appears only when the child is a sibling** —
 * absent, not greyed. A disabled section invites the operator to hunt for the
 * permission that would enable it, and there is none: they are not a sibling.
 */

export interface DiscountSchemeOption {
  id: string;
  name: string;
  schemeType: SchemeType;
  discountType: 'percentage' | 'fixed';
  discountValue: string;
  /** Empty means every fee head, of every category. */
  feeTypeNames: string[];
  alreadyGranted: boolean;
}

export interface DiscountGrantRow {
  id: string;
  concessionName: string;
  discountType: 'percentage' | 'fixed';
  discountValue: string;
  validFrom: string;
  validUntil: string | null;
  schemeId: string | null;
  schemeType: SchemeType | null;
  feeTypeNames: string[];
  isOpen: boolean;
}

interface FamilyMember {
  studentProfileId: string;
  studentId: string;
  name: string;
  enrollmentDate: string;
  branchId: string | null;
  branchName: string | null;
}

interface SiblingRowLite {
  studentProfileId: string;
  studentId: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
  isCurrentlyEnrolled: boolean;
}

interface DiscountState {
  studentProfileId: string | null;
  studentName: string;
  grants: DiscountGrantRow[];
  schemes: DiscountSchemeOption[];
  sibling: {
    family: FamilyMember[];
    siblings: SiblingRowLite[];
    rank: number;
    qualifies: boolean;
  };
  autoApply: boolean;
}

export interface StudentDiscountPanelProps {
  /** The enrolled child. Null in the wizard, where they do not exist yet. */
  studentProfileId?: string | null;
  /**
   * The guardians a clerk has typed, for the wizard. Ignored when
   * `studentProfileId` is set — an enrolled child's family is read off their
   * own guardian rows, which is the authoritative version.
   */
  draftGuardians?: readonly { cnic: string; phone: string }[];
  /** What to call the child in the sentence. */
  studentName: string;
  /** `fees.write`. Without it the panel reports and does not change. */
  canEdit: boolean;
  /** Wizard mode: the chosen schemes, lifted so the enrolment can carry them. */
  selectedSchemeIds?: readonly string[];
  onSelectionChange?: (schemeIds: string[]) => void;
  /** The campus this record belongs to, so a sibling elsewhere is named. */
  contextBranchId?: string | null;
}

/** `20%` or `PKR 5,000`, the way a chip should read it. */
function rateOf(discountType: 'percentage' | 'fixed', discountValue: string): string {
  return discountType === 'percentage'
    ? `${String(Number(discountValue))}%`
    : formatPkr(discountValue);
}

/** What a scheme applies to, in the words the modal has to say out loud. */
function scopeOf(feeTypeNames: readonly string[]): string {
  return feeTypeNames.length === 0
    ? 'applies to every fee head'
    : `applies to ${feeTypeNames.join(', ')}`;
}

export function StudentDiscountPanel({
  studentProfileId = null,
  draftGuardians,
  studentName,
  canEdit,
  selectedSchemeIds,
  onSelectionChange,
  contextBranchId,
}: StudentDiscountPanelProps) {
  const [state, setState] = useState<DiscountState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  /** The modal's own selection, one scheme id per type at most. */
  const [draft, setDraft] = useState<Partial<Record<SchemeType, string>>>({});

  const isDraftMode = studentProfileId === null;

  /*
   * The guardian identities, flattened into a stable query string.
   *
   * Serialised rather than passed as an array so the effect below depends on a
   * *value*: a fresh array of the same guardians on every keystroke of the
   * wizard would otherwise refetch the panel on every keystroke.
   */
  const draftQuery = useMemo(() => {
    const params = new URLSearchParams();
    for (const guardian of draftGuardians ?? []) {
      if (guardian.cnic.trim() !== '') params.append('cnic', guardian.cnic.trim());
      if (guardian.phone.trim() !== '') params.append('phone', guardian.phone.trim());
    }
    return params.toString();
  }, [draftGuardians]);

  const load = useCallback(async () => {
    const query = new URLSearchParams();

    if (studentProfileId !== null) query.set('studentProfileId', studentProfileId);
    else {
      query.set('studentName', studentName);
      for (const [key, value] of new URLSearchParams(draftQuery)) query.append(key, value);
    }

    try {
      setState(await schoolFetch<DiscountState>(
        `/api/school/fees/student-discounts?${query.toString()}`,
      ));
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the discounts.'));
      setState(null);
    }
  }, [studentProfileId, studentName, draftQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * The wizard's selection is the caller's state, so it is mirrored back into
   * the modal when the step is re-entered. Without this, going Back to
   * Documents and forward again would show an empty modal over a selection the
   * review step still lists.
   */
  useEffect(() => {
    if (!isDraftMode || state === null) return;

    const next: Partial<Record<SchemeType, string>> = {};
    for (const id of selectedSchemeIds ?? []) {
      const scheme = state.schemes.find((option) => option.id === id);
      if (scheme !== undefined) next[scheme.schemeType] = scheme.id;
    }
    setDraft(next);
  }, [isDraftMode, selectedSchemeIds, state]);

  const openGrants = (state?.grants ?? []).filter((grant) => grant.isOpen);

  /*
   * The sections the modal shows, in a fixed order.
   *
   * Sibling is **absent** rather than disabled when the child is not one. A
   * greyed-out section is a promise that some permission or setting would
   * enable it, and there is none to find: they do not have a brother or sister
   * here.
   */
  const sections = SCHEME_TYPES.filter((type) => {
    if (type === 'sibling' && state?.sibling.qualifies !== true) return false;
    return (state?.schemes ?? []).some((scheme) => scheme.schemeType === type);
  });

  const selectionIds = Object.values(draft).filter(
    (value): value is string => value !== undefined,
  );

  const apply = async (): Promise<void> => {
    if (studentProfileId === null) {
      onSelectionChange?.(selectionIds);
      setPicking(false);
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{
        granted: number;
        skipped: number;
        repricedVouchers: number;
      }>('/api/school/fees/student-discounts', {
        method: 'POST',
        body: JSON.stringify({ studentProfileId, schemeIds: selectionIds }),
      });

      setNotice(
        `${String(result.granted)} discount${result.granted === 1 ? '' : 's'} applied` +
          `${result.skipped === 0 ? '' : `, ${String(result.skipped)} already held`}. ` +
          `${String(result.repricedVouchers)} open voucher${
            result.repricedVouchers === 1 ? '' : 's'
          } repriced.`,
      );
      setPicking(false);
      setDraft({});
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not apply the discount.'));
    } finally {
      setBusy(false);
    }
  };

  const removeGrant = async (grant: DiscountGrantRow): Promise<void> => {
    if (studentProfileId === null) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{ repricedVouchers: number }>(
        '/api/school/fees/student-discounts',
        {
          method: 'PATCH',
          body: JSON.stringify({ studentProfileId, concessionId: grant.id }),
        },
      );

      setNotice(
        `“${grant.concessionName}” removed. ${String(result.repricedVouchers)} open ` +
          `voucher${result.repricedVouchers === 1 ? '' : 's'} repriced. Vouchers already ` +
          'issued keep the discount they were raised with.',
      );
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not remove the discount.'));
    } finally {
      setBusy(false);
    }
  };

  /** The selected schemes, for the wizard's own summary line. */
  const chosen = (state?.schemes ?? []).filter((scheme) =>
    (selectedSchemeIds ?? []).includes(scheme.id),
  );

  return (
    <Card
      header={
        <CardTitle
          title="Discounts"
          description={
            isDraftMode
              ? 'Optional. Anything chosen here is granted the moment the enrolment completes, and can be changed afterwards from the student’s profile.'
              : 'What this student is charged less than the full rate for. Applying one reprices anything they still owe; a voucher already paid is never touched.'
          }
          action={
            canEdit && state !== null ? (
              <Button
                size="sm"
                disabled={busy || sections.length === 0}
                title={
                  sections.length === 0
                    ? 'This school has no active discount schemes to apply.'
                    : undefined
                }
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setPicking(true);
                }}
              >
                Apply discount
              </Button>
            ) : undefined
          }
        />
      }
    >
      {error !== null ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p
          role="status"
          className="mb-4 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle"
        >
          {notice}
        </p>
      ) : null}

      {state === null && error === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : null}

      {state === null ? null : (
        <div className="space-y-4">
          {/*
            State 1. The sibling sentence, and it names the sibling — "Sara has
            a brother at this school" is a fact somebody can check, and "this
            student qualifies" is an assertion they cannot.

            Suppressed once a sibling discount is actually held, because at that
            point the chip below says the same thing and says it better.
          */}
          {state.sibling.qualifies &&
          !openGrants.some((grant) => grant.schemeType === 'sibling') ? (
            <p className="rounded-lg bg-brand-primarySubtle px-3 py-2 text-sm text-brand-onPrimarySubtle">
              {state.studentName} has{' '}
              {state.sibling.siblings.length === 1
                ? 'a sibling'
                : `${String(state.sibling.siblings.length)} siblings`}{' '}
              at this school
              {state.sibling.siblings
                .filter((sibling) => sibling.isCurrentlyEnrolled)
                .map((sibling) => (
                  <span key={sibling.studentProfileId} className="ml-1">
                    — <span className="font-medium">{sibling.name}</span>
                    {sibling.branchName !== null &&
                    (contextBranchId === undefined ||
                      contextBranchId === null ||
                      contextBranchId !== sibling.branchId) ? (
                      // Item 8. Name the campus when it is not this one: a
                      // clerk at Defence reading a discount granted for a child
                      // at Karachi needs to see why.
                      <span className="text-ink-muted"> ({sibling.branchName})</span>
                    ) : null}
                  </span>
                ))}
              . They qualify for the sibling discount
              {state.autoApply
                ? ', which this school applies automatically.'
                : '.'}
            </p>
          ) : null}

          {/* State 2, on the profile: one chip per grant, each removable. */}
          {openGrants.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {openGrants.map((grant) => (
                <li
                  key={grant.id}
                  className="inline-flex items-center gap-2 rounded-full bg-surface-sunken px-3 py-1 text-xs text-ink"
                >
                  <span>
                    <span className="font-medium">{grant.concessionName}</span> ·{' '}
                    {rateOf(grant.discountType, grant.discountValue)}
                  </span>
                  <span className="text-ink-muted">
                    {grant.feeTypeNames.length === 0
                      ? 'every head'
                      : grant.feeTypeNames.join(', ')}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remove ${grant.concessionName}`}
                      className="rounded-full px-1 text-ink-muted hover:text-status-danger-ink disabled:opacity-50"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove “${grant.concessionName}” from ${state.studentName}? ` +
                              'Anything they still owe is repriced without it. Vouchers ' +
                              'already issued keep the discount they were raised with, ' +
                              'and the grant stays on record so those slips can still be ' +
                              'explained.',
                          )
                        ) {
                          void removeGrant(grant);
                        }
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {/* State 2, in the wizard: what will be granted when this commits. */}
          {isDraftMode && chosen.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {chosen.map((scheme) => (
                <li key={scheme.id}>
                  <Badge variant="brand">
                    {scheme.name} · {rateOf(scheme.discountType, scheme.discountValue)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}

          {/* State 3. */}
          {openGrants.length === 0 && chosen.length === 0 && !state.sibling.qualifies ? (
            <p className="text-sm text-ink-muted">
              {sections.length === 0
                ? 'This school has no active discount schemes yet. They are defined under Fees → Concessions.'
                : `No discount is applied to ${state.studentName}. They are billed at the full rate for their grade.`}
            </p>
          ) : null}
        </div>
      )}

      <Modal
        open={picking && state !== null}
        size="lg"
        title="Apply a discount"
        description="At most one of each kind. Each one carries the scheme's rate and dates as they stand today; editing the scheme later does not change what has been granted."
        onClose={() => {
          if (!busy) setPicking(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPicking(false);
              }}
            >
              Cancel
            </Button>
            <Button
              isLoading={busy}
              disabled={selectionIds.length === 0}
              onClick={() => {
                void apply();
              }}
            >
              {isDraftMode
                ? `Choose ${String(selectionIds.length)} discount${selectionIds.length === 1 ? '' : 's'}`
                : `Apply ${String(selectionIds.length)} discount${selectionIds.length === 1 ? '' : 's'}`}
            </Button>
          </>
        }
      >
        {state === null ? null : (
          <div className="space-y-5">
            {sections.length === 0 ? (
              <p className="text-sm text-ink-muted">
                This school has no active discount schemes. They are defined under
                Fees → Concessions.
              </p>
            ) : null}

            {sections.map((type) => {
              const options = state.schemes.filter(
                (scheme) => scheme.schemeType === type,
              );

              return (
                <fieldset key={type}>
                  <legend className="mb-1.5 text-sm font-medium text-ink">
                    {SCHEME_TYPE_LABELS[type]}
                  </legend>

                  <div className="space-y-2">
                    {options.map((scheme) => (
                      <label
                        key={scheme.id}
                        className="flex items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm"
                      >
                        {/*
                          A radio, one group per section (item 7c). Selecting a
                          second scholarship replaces the first rather than
                          stacking on it — two scholarships on one child is a
                          school that has decided twice and a voucher line
                          nobody can explain.
                        */}
                        <input
                          type="radio"
                          name={`discount-${type}`}
                          className="mt-0.5 h-4 w-4 accent-brand-primary"
                          value={scheme.id}
                          checked={draft[type] === scheme.id}
                          disabled={busy || scheme.alreadyGranted}
                          onChange={() => {
                            setDraft((current) => ({ ...current, [type]: scheme.id }));
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-ink">
                            {scheme.name} ·{' '}
                            {rateOf(scheme.discountType, scheme.discountValue)}
                          </span>
                          {/*
                            The head set said out loud, per section. An empty
                            set is the **wide** case — every fee head, of every
                            category — and STATE.md §5be records at length what
                            reading it narrowly cost the last time.
                          */}
                          <span className="block text-xs text-ink-muted">
                            {scopeOf(scheme.feeTypeNames)}
                          </span>
                        </span>
                        {scheme.alreadyGranted ? (
                          <Badge variant="neutral">Already applied</Badge>
                        ) : null}
                      </label>
                    ))}

                    {draft[type] === undefined ? null : (
                      <button
                        type="button"
                        disabled={busy}
                        className="text-xs font-medium text-brand-primary hover:underline"
                        onClick={() => {
                          setDraft((current) => {
                            const next = { ...current };
                            delete next[type];
                            return next;
                          });
                        }}
                      >
                        Clear this choice
                      </button>
                    )}
                  </div>
                </fieldset>
              );
            })}
          </div>
        )}
      </Modal>
    </Card>
  );
}
