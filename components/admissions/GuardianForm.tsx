'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CnicField } from '@/components/ui/CnicField';
import { Input } from '@/components/ui/Input';
import { PhoneField } from '@/components/ui/PhoneField';
import { Select } from '@/components/ui/Select';
import {
  FIRST_GUARDIAN_RELATIONSHIPS,
  GUARDIAN_RELATIONSHIPS,
  GUARDIAN_RELATIONSHIP_LABELS,
  SINGLETON_RELATIONSHIPS,
  type GuardianRelationship,
} from '@/db/schema/student-guardians';
import { cnicProblem, isValidCnic } from '@/lib/national-id';
import { isValidPhone } from '@/lib/phone';
import { schoolFetch } from '@/lib/school-client';

/**
 * The guardian step of an enrolment — and the point at which a family is
 * recognised.
 *
 * ── The CNIC is the first field on the card, and that is the feature ─────
 * It used to be the fifth, an unmasked free-text box after name, relationship,
 * phone and email. By the time the clerk reached it the guardian had already
 * been created in their head as a new person, and the number was a formality
 * they often skipped.
 *
 * Asking for it first inverts that. A complete CNIC is looked up against every
 * guardian already at this school; when it matches, the card fills itself in
 * from the record the school already holds and says, by name and admission
 * number, which children this person is already the guardian of. Those children
 * become the new student's siblings the moment the enrolment lands — not
 * because anything is written to link them, but because they now share a
 * guardian identity. See `lib/siblings.ts`.
 *
 * The prefill never overwrites something the clerk has already typed. A father
 * whose number has changed is corrected on this screen, and the correction must
 * survive the lookup that arrives a moment later.
 *
 * ── The three relationship rules, and where each is enforced ─────────────
 *   1. **The first guardian cannot be "Other".** A child's first recorded
 *      guardian is who the school holds responsible; "Other" is the absence of
 *      an answer to that.
 *   2. **Father and Mother are each available once.** A second row claiming
 *      either is a duplicate, and a duplicate is what splits one family into
 *      two on the sibling lookup and the family voucher.
 *   3. **"Other" must say what it means.** The free-text relation is required
 *      whenever "Other" is chosen — "Other" alone records nothing a teacher
 *      ringing this number could use.
 *
 * All three are enforced here *and* in `parseGuardians` on the server. The
 * dropdown is a courtesy; the server is the rule.
 */

/** One guardian as the form holds it — phone is still raw user input here. */
export interface GuardianDraft {
  name: string;
  relationship: GuardianRelationship;
  /** Required when `relationship` is `other`, ignored otherwise. */
  relationshipOther: string;
  phone: string;
  email: string;
  cnic: string;
  occupation: string;
  isPrimaryContact: boolean;
}

/** A child this guardian is already recorded against, from the CNIC lookup. */
export interface KnownChild {
  studentProfileId: string;
  studentId: string;
  name: string;
  gradeName: string | null;
  sectionName: string | null;
}

export function emptyGuardian(isPrimaryContact: boolean): GuardianDraft {
  return {
    name: '',
    relationship: 'father',
    relationshipOther: '',
    phone: '',
    email: '',
    cnic: '',
    occupation: '',
    isPrimaryContact,
  };
}

/**
 * Which relationships one guardian card may offer.
 *
 * Exported because the server re-derives the same set and the guardian panel on
 * a student's profile uses it too — three copies of "father is taken" is how
 * one of them ends up letting a second father through.
 */
export function availableRelationships(
  guardians: readonly { relationship: GuardianRelationship }[],
  index: number,
): GuardianRelationship[] {
  const isFirst = index === 0;

  const takenElsewhere = new Set(
    guardians
      .filter((_, position) => position !== index)
      .map((guardian) => guardian.relationship),
  );

  return GUARDIAN_RELATIONSHIPS.filter((relationship) => {
    if (
      isFirst &&
      !(FIRST_GUARDIAN_RELATIONSHIPS as readonly string[]).includes(relationship)
    ) {
      // Except when it is already the value — a record loaded from before this
      // rule existed must not silently change relationship because its own
      // value vanished from the list it is bound to.
      return guardians[index]?.relationship === relationship;
    }

    if (
      (SINGLETON_RELATIONSHIPS as readonly string[]).includes(relationship) &&
      takenElsewhere.has(relationship)
    ) {
      return guardians[index]?.relationship === relationship;
    }

    return true;
  });
}

/**
 * What is wrong with the guardian step, or null.
 *
 * Lives here rather than in the enrolment form so that the rules and the fields
 * that break them cannot drift apart.
 */
export function guardiansProblem(guardians: readonly GuardianDraft[]): string | null {
  if (guardians.length === 0) return 'A student needs at least one guardian.';

  const first = guardians[0];
  if (
    first !== undefined &&
    !(FIRST_GUARDIAN_RELATIONSHIPS as readonly string[]).includes(first.relationship)
  ) {
    return 'The first guardian must be the student’s father, mother or sibling. Add anyone else as a second guardian.';
  }

  for (const relationship of SINGLETON_RELATIONSHIPS) {
    if (guardians.filter((guardian) => guardian.relationship === relationship).length > 1) {
      return `Only one guardian can be recorded as ${GUARDIAN_RELATIONSHIP_LABELS[relationship]}.`;
    }
  }

  for (const [position, guardian] of guardians.entries()) {
    if (guardian.name.trim() === '') {
      return `Guardian ${String(position + 1)} needs a full name.`;
    }
    if (!isValidPhone(guardian.phone)) {
      return `Guardian ${String(position + 1)} needs a valid Pakistani mobile number.`;
    }
    if (guardian.relationship === 'other' && guardian.relationshipOther.trim() === '') {
      return `Say how guardian ${String(position + 1)} is related to this student.`;
    }

    const cnic = cnicProblem(guardian.cnic);
    if (cnic !== null) return `Guardian ${String(position + 1)}: ${cnic}`;
  }

  const cnics = guardians
    .map((guardian) => guardian.cnic.trim())
    .filter((value) => value !== '');
  if (new Set(cnics).size !== cnics.length) {
    return 'Two guardians on this student share a CNIC. One person cannot be recorded twice.';
  }

  return null;
}

export interface GuardianFormProps {
  guardians: readonly GuardianDraft[];
  onChange: (guardians: GuardianDraft[]) => void;
  maxGuardians: number;
  disabled?: boolean;
}

/**
 * Exactly one guardian is the primary contact at any moment — the school needs
 * a single number to write to about fees and absences, so choosing one demotes
 * the rest here rather than leaving the server to guess.
 */
export function GuardianForm({
  guardians,
  onChange,
  maxGuardians,
  disabled = false,
}: GuardianFormProps) {
  /** Lookup results, keyed by card position. */
  const [known, setKnown] = useState<Record<number, KnownChild[]>>({});
  const [matched, setMatched] = useState<Record<number, string | null>>({});
  const [looking, setLooking] = useState<number | null>(null);

  /*
   * The current cards, readable from inside an in-flight lookup.
   *
   * `onChange` takes a whole array rather than an updater, so a lookup that
   * resolves after the clerk has started typing would otherwise write back the
   * array as it stood when the request left — silently undoing the name they
   * just entered. The ref is what makes "only fill empty fields" true at the
   * moment the answer arrives rather than at the moment it was asked for.
   */
  const latest = useRef<readonly GuardianDraft[]>(guardians);
  latest.current = guardians;

  const update = (index: number, patch: Partial<GuardianDraft>): void => {
    onChange(
      latest.current.map((guardian, position) =>
        position === index ? { ...guardian, ...patch } : guardian,
      ),
    );
  };

  /**
   * Fill in a guardian from the record this school already holds.
   *
   * Only empty fields are written. The clerk is looking at the person; the
   * database is looking at what was true the last time somebody looked at them.
   * Where the two disagree the clerk wins, which is why a correction typed
   * before the lookup returns is never undone by it.
   */
  const lookUp = async (index: number, cnic: string): Promise<void> => {
    setLooking(index);

    try {
      const result = await schoolFetch<{
        guardian: {
          name: string;
          phone: string;
          email: string | null;
          occupation: string | null;
        } | null;
        students: KnownChild[];
      }>(`/api/school/guardians/lookup?cnic=${encodeURIComponent(cnic)}`);

      setKnown((current) => ({ ...current, [index]: result.students }));
      setMatched((current) => ({
        ...current,
        [index]: result.guardian?.name ?? null,
      }));

      const found = result.guardian;
      if (found === null) return;

      const current = latest.current[index];
      if (current === undefined) return;

      update(index, {
        name: current.name.trim() === '' ? found.name : current.name,
        phone: current.phone.trim() === '' ? found.phone : current.phone,
        email: current.email.trim() === '' ? (found.email ?? '') : current.email,
        occupation:
          current.occupation.trim() === ''
            ? (found.occupation ?? '')
            : current.occupation,
      });
    } catch {
      // A lookup that fails leaves the clerk typing the guardian by hand, which
      // is exactly what they did before this existed. It is never worth an
      // error box on a form that is otherwise working.
      setKnown((current) => ({ ...current, [index]: [] }));
      setMatched((current) => ({ ...current, [index]: null }));
    } finally {
      setLooking(null);
    }
  };

  /*
   * A card that arrives already carrying a whole CNIC is looked up too.
   *
   * That is the converted-application path: the parent typed their number on
   * the public form weeks ago, and the clerk converting it never touches the
   * field — so `onComplete`, which fires on a keystroke, would never fire. It
   * is exactly the case most likely to be a returning family.
   */
  useEffect(() => {
    for (const [index, guardian] of latest.current.entries()) {
      if (isValidCnic(guardian.cnic) && !(index in matched)) {
        void lookUp(index, guardian.cnic);
      }
    }
    // Once, on mount. Later completions are `onComplete`'s job, and re-running
    // this on every edit would re-query on every keystroke of the name field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPrimary = (index: number): void => {
    onChange(
      guardians.map((guardian, position) => ({
        ...guardian,
        isPrimaryContact: position === index,
      })),
    );
  };

  const remove = (index: number): void => {
    const remaining = guardians.filter((_, position) => position !== index);

    // Removing the primary would leave nobody flagged, so the first takes over.
    if (!remaining.some((guardian) => guardian.isPrimaryContact)) {
      onChange(
        remaining.map((guardian, position) => ({
          ...guardian,
          isPrimaryContact: position === 0,
        })),
      );
      return;
    }

    onChange(remaining);
  };

  return (
    <div className="space-y-4">
      {guardians.map((guardian, index) => {
        const children = known[index] ?? [];
        const matchedName = matched[index] ?? null;

        return (
          <Card
            key={index}
            header={
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink">
                  Guardian {index + 1}
                  {guardian.isPrimaryContact ? (
                    <span className="ml-2 rounded-full bg-brand-primary/10 px-2 py-0.5 text-xs font-medium text-brand-primary">
                      Primary contact
                    </span>
                  ) : null}
                </h3>

                {guardians.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      remove(index);
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {/*
                First on the card, and spanning both columns, because it is the
                question that decides whether the rest of this card is a new
                person or one the school already knows.
              */}
              <div className="sm:col-span-2">
                <CnicField
                  value={guardian.cnic}
                  disabled={disabled}
                  hint={
                    looking === index
                      ? 'Checking whether this school already knows this guardian…'
                      : 'Enter this first — if this guardian already has a child here, the rest of the form fills itself in.'
                  }
                  onChange={(next) => {
                    update(index, { cnic: next });
                  }}
                  onComplete={(next) => {
                    void lookUp(index, next);
                  }}
                />
              </div>

              {children.length > 0 ? (
                <div className="rounded-lg bg-status-info-subtle px-3 py-2.5 text-sm text-status-info-onSubtle sm:col-span-2">
                  <p className="font-medium">
                    {matchedName ?? 'This guardian'} already has{' '}
                    {children.length === 1
                      ? 'a child'
                      : `${String(children.length)} children`}{' '}
                    at this school.
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {children.map((child) => (
                      <li key={child.studentProfileId}>
                        {child.name} · <span className="font-mono">{child.studentId}</span>
                        {child.gradeName === null
                          ? ''
                          : ` · ${child.gradeName}${
                              child.sectionName === null ? '' : ` ${child.sectionName}`
                            }`}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs opacity-80">
                    The student you are enrolling will be recorded as their
                    sibling. Check the details below are still correct before
                    continuing.
                  </p>
                </div>
              ) : matchedName !== null ? (
                <p className="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted sm:col-span-2">
                  Filled in from {matchedName}’s existing record at this school.
                </p>
              ) : null}

              <Input
                label="Full name"
                required
                value={guardian.name}
                disabled={disabled}
                onChange={(event) => {
                  update(index, { name: event.target.value });
                }}
              />

              <Select
                label="Relationship"
                options={availableRelationships(guardians, index).map((value) => ({
                  value,
                  label: GUARDIAN_RELATIONSHIP_LABELS[value],
                }))}
                hint={
                  index === 0
                    ? 'The first guardian is the person the school holds responsible.'
                    : undefined
                }
                value={guardian.relationship}
                disabled={disabled}
                onChange={(event) => {
                  update(index, {
                    relationship: event.target.value as GuardianRelationship,
                  });
                }}
              />

              {guardian.relationship === 'other' ? (
                <div className="sm:col-span-2">
                  <Input
                    label="Relation with this student"
                    required
                    placeholder="e.g. Paternal uncle, sponsor, elder cousin"
                    hint="“Other” on its own tells a teacher ringing this number nothing."
                    value={guardian.relationshipOther}
                    disabled={disabled}
                    onChange={(event) => {
                      update(index, { relationshipOther: event.target.value });
                    }}
                  />
                </div>
              ) : null}

              <PhoneField
                label="Phone"
                required
                // Identity: this number is the unique index on
                // `student_guardians` and what an invitation resolves, so the
                // server puts it through `normalizePhone` and will refuse a
                // landline. The dropdown still offers one, and says why not.
                identity
                hint="This is how the school will reach you."
                value={guardian.phone}
                disabled={disabled}
                onChange={(next) => {
                  update(index, { phone: next });
                }}
              />

              <Input
                label="Email"
                type="email"
                hint="Needed to open a parent portal account for this guardian."
                value={guardian.email}
                disabled={disabled}
                onChange={(event) => {
                  update(index, { email: event.target.value });
                }}
              />

              <Input
                label="Occupation"
                value={guardian.occupation}
                disabled={disabled}
                onChange={(event) => {
                  update(index, { occupation: event.target.value });
                }}
              />

              <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
                <input
                  type="radio"
                  name="primary-guardian"
                  className="h-4 w-4"
                  checked={guardian.isPrimaryContact}
                  disabled={disabled}
                  onChange={() => {
                    setPrimary(index);
                  }}
                />
                Primary contact for this student
              </label>
            </div>
          </Card>
        );
      })}

      {guardians.length < maxGuardians ? (
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            // The second guardian defaults to Mother where that is still free,
            // because it is the answer nine times in ten. `emptyGuardian`
            // cannot know that — it does not see the other cards.
            const taken = new Set(guardians.map((entry) => entry.relationship));
            const next = emptyGuardian(false);
            onChange([
              ...guardians,
              {
                ...next,
                relationship: taken.has('mother')
                  ? taken.has('father')
                    ? 'guardian'
                    : 'father'
                  : 'mother',
              },
            ]);
          }}
        >
          Add another guardian
        </Button>
      ) : (
        <p className="text-sm text-ink-muted">
          Up to {maxGuardians} guardians can be recorded per student.
        </p>
      )}

      <p className="text-sm text-ink-muted">
        Every guardian recorded here with an email address is offered a parent
        portal account of their own. One account shows every child that guardian
        is recorded against, so a parent with three children here signs in once.
      </p>
    </div>
  );
}
