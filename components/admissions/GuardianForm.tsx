'use client';

import { useEffect, useRef, useState } from 'react';

import {
  AddressAutocomplete,
  type LocationValue,
} from '@/components/ui/AddressAutocomplete';
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
  firstGuardianChoices,
  type GuardianRelationship,
} from '@/db/schema/student-guardians';
import { cnicProblem, isValidCnic } from '@/lib/national-id';
import { formatPhoneForDisplay } from '@/lib/phone-formats';
import { isValidPhone } from '@/lib/phone';
import { schoolFetch } from '@/lib/school-client';

/**
 * The guardian step of an enrollment — and the point at which a family is
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
 * become the new student's siblings the moment the enrollment lands — not
 * because anything is written to link them, but because they now share a
 * guardian identity. See `lib/siblings.ts`.
 *
 * The prefill never overwrites something the clerk has already typed.
 *
 * ── Sprint 18: the card is locked until the CNIC has been answered ───────
 * Every field except `CnicField` starts `disabled` on a fresh card. It unlocks
 * when one of two things has happened:
 *
 *   · the lookup has returned — match or no match, either is an answer; or
 *   · the clerk has pressed **"No CNIC to hand — enter by hand"**, which is
 *     only offered while the field is blank.
 *
 * The escape hatch is not optional politeness. CLAUDE.md's rule is that blank
 * is always allowed, because an admissions desk with a queue in front of it
 * will invent a number to get past a required field, and an invented CNIC is
 * worse than an absent one now that the column decides who is related to whom.
 * The lock exists to make asking for the card the path of least resistance, not
 * to make it the only path.
 *
 * ── And when it matches, the person is not editable here ─────────────────
 * A matched guardian already exists at this school. Their **name, email and
 * phone** render `disabled`, pointing at the guardian panel on the sibling's
 * profile. Correcting a father's number *during another child's enrollment* is
 * precisely how one person becomes two records with two different numbers —
 * which is what splits a family, silently, on a screen that was doing the right
 * thing. Relationship, occupation and primary contact stay editable: they are
 * facts about *this* child rather than about the person.
 *
 * Editing the CNIC away from a match unlocks them again. Unlocking is sticky in
 * the other direction: a card that has once been answered is never re-locked,
 * because taking fields away from somebody mid-sentence is not a safety feature.
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
  /**
   * Where this guardian lives — Sprint 19b, item 18.
   *
   * A `LocationValue`, which is what `AddressAutocomplete` speaks, so the field
   * that fills it and the column that stores it agree without a translation
   * step in between. Both coordinates stay null whenever the operator typed the
   * address rather than choosing a suggestion, which in Pakistan is most of
   * them and is a supported outcome rather than a degraded one.
   */
  location: LocationValue;
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
    location: { address: '', latitude: null, longitude: null },
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
 * Lives here rather than in the enrollment form so that the rules and the fields
 * that break them cannot drift apart.
 */
export function guardiansProblem(guardians: readonly GuardianDraft[]): string | null {
  if (guardians.length === 0) return 'A student needs at least one guardian.';

  const first = guardians[0];
  if (
    first !== undefined &&
    !(FIRST_GUARDIAN_RELATIONSHIPS as readonly string[]).includes(first.relationship)
  ) {
    return `The first guardian must be the student’s ${firstGuardianChoices()}. Add anyone else as a second guardian.`;
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

/**
 * One card's entry removed from a per-card record.
 *
 * Written out rather than destructured with a discarded binding: the lint rule
 * on unused variables is an error here, and a rest-spread that throws away a
 * key needs one.
 */
function withoutCard<Value>(
  record: Record<number, Value>,
  index: number,
): Record<number, Value> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => Number(key) !== index),
  ) as Record<number, Value>;
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

  /**
   * Cards whose CNIC question has been answered, and are therefore editable.
   *
   * Set by a lookup returning and by the escape hatch, and never cleared. The
   * *match* is what a CNIC edit invalidates (`matched` above); the answer is
   * not — a card that unlocked and then had its number corrected must not have
   * its fields taken back while somebody is typing into them.
   */
  const [unlocked, setUnlocked] = useState<Record<number, boolean>>({});

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
          relationship: GuardianRelationship;
        } | null;
        students: KnownChild[];
      }>(`/api/school/guardians/lookup?cnic=${encodeURIComponent(cnic)}`);

      setKnown((current) => ({ ...current, [index]: result.students }));
      setMatched((current) => ({
        ...current,
        [index]: result.guardian?.name ?? null,
      }));
      // An answer either way. "Nobody by that number" is as much of an answer
      // as a match, and the card fills in by hand from here.
      setUnlocked((current) => ({ ...current, [index]: true }));

      const found = result.guardian;
      if (found === null) return;

      const current = latest.current[index];
      if (current === undefined) return;

      /*
       * The relationship is adopted rather than protected, unlike every other
       * field here.
       *
       * There is nothing typed to protect: the dropdown is always carrying a
       * value, defaulted to Father on the first card, so "only fill what is
       * empty" has no meaning for it. What the school already holds is a better
       * default than the form's — a mother enrolling her second child was being
       * offered Father, and the clerk who left it created a second father and
       * split the family the lookup had just recognised.
       *
       * Only when it is still free for this student. `availableRelationships`
       * is the same rule the dropdown is built from, so this can never select
       * an option that is not in it.
       */
      const offered = availableRelationships(latest.current, index);
      const relationship = offered.includes(found.relationship)
        ? found.relationship
        : current.relationship;

      update(index, {
        name: current.name.trim() === '' ? found.name : current.name,
        // Stored canonically as `+923211234567`; the field speaks
        // `(0321) 123-4567`, and handing it the stored form is what made it
        // show an error on a number the server itself wrote.
        phone:
          current.phone.trim() === ''
            ? formatPhoneForDisplay(found.phone)
            : current.phone,
        email: current.email.trim() === '' ? (found.email ?? '') : current.email,
        occupation:
          current.occupation.trim() === ''
            ? (found.occupation ?? '')
            : current.occupation,
        relationship,
      });
    } catch {
      // A lookup that fails leaves the clerk typing the guardian by hand, which
      // is exactly what they did before this existed. It is never worth an
      // error box on a form that is otherwise working — and it must unlock the
      // card, or a network blip becomes an enrollment nobody can complete.
      setKnown((current) => ({ ...current, [index]: [] }));
      setMatched((current) => ({ ...current, [index]: null }));
      setUnlocked((current) => ({ ...current, [index]: true }));
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
        continue;
      }

      /*
       * A card that arrives carrying somebody's details is not a fresh card.
       *
       * The lock is for the guardian step of a new enrollment, where the CNIC is
       * the first question. A converted application has already been filled in
       * from what the parent typed on the public form weeks ago — often with no
       * CNIC at all — and locking that would leave the clerk staring at a name
       * and a number they cannot correct, with an escape hatch that only offers
       * itself when the field is blank.
       */
      if (
        guardian.name.trim() !== '' ||
        guardian.phone.trim() !== '' ||
        guardian.email.trim() !== ''
      ) {
        setUnlocked((current) => ({ ...current, [index]: true }));
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

        // Item 2: nothing but the CNIC until the question has been answered.
        const answered = unlocked[index] === true;
        // Item 1: a person the school already holds is not edited from here.
        const identityLocked = matchedName !== null;

        const fieldsDisabled = disabled || !answered;
        const identityDisabled = fieldsDisabled || identityLocked;
        const identityHint = identityLocked
          ? `Recorded against ${matchedName}’s existing guardian record. Change it from that child’s profile so it changes everywhere.`
          : undefined;

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
                      : answered
                        ? 'If this guardian already has a child here, the rest of the form fills itself in.'
                        : 'Enter this first — the rest of the card opens once we have checked it.'
                  }
                  onChange={(next) => {
                    /*
                     * A CNIC edit invalidates the match, and only the match.
                     * The identity fields open again the moment the number
                     * stops naming the person they were filled from — which is
                     * the whole of "clearing or changing the CNIC unlocks them".
                     */
                    setMatched((current) => withoutCard(current, index));
                    setKnown((current) => withoutCard(current, index));
                    update(index, { cnic: next });
                  }}
                  onComplete={(next) => {
                    void lookUp(index, next);
                  }}
                />
              </div>

              {/*
                The escape hatch, offered only while the field is blank.
                CLAUDE.md: blank is always allowed, and a clerk who cannot get
                past a required field invents a number — which is worse than an
                absent one now that this column decides who is related to whom.
              */}
              {answered || disabled || guardian.cnic.trim() !== '' ? null : (
                <div className="sm:col-span-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setUnlocked((current) => ({ ...current, [index]: true }));
                    }}
                  >
                    No CNIC to hand — enter by hand
                  </Button>
                </div>
              )}

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
                disabled={identityDisabled}
                hint={identityHint}
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
                // Editable even on a match: how this person is related is a
                // fact about *this* child, not about the person.
                disabled={fieldsDisabled}
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
                    disabled={fieldsDisabled}
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
                hint={identityHint ?? 'This is how the school will reach you.'}
                value={guardian.phone}
                disabled={identityDisabled}
                onChange={(next) => {
                  update(index, { phone: next });
                }}
              />

              <Input
                label="Email"
                type="email"
                hint={
                  identityHint ??
                  'Needed to open a parent portal account for this guardian.'
                }
                value={guardian.email}
                disabled={identityDisabled}
                onChange={(event) => {
                  update(index, { email: event.target.value });
                }}
              />

              <Input
                label="Occupation"
                value={guardian.occupation}
                disabled={fieldsDisabled}
                onChange={(event) => {
                  update(index, { occupation: event.target.value });
                }}
              />

              {/*
                Item 18. `AddressAutocomplete` rather than an `Input`, which is
                the standing rule — `npm run check-address-phone` enforces it —
                and which here also means Mapbox's absence degrades to a plain
                text box exactly as it does on the school and branch forms.

                Editable on a match, unlike name, phone and email. Where a
                guardian lives is a fact about *this* enrollment as much as about
                the person: a family that has moved since an older child was
                enrolled will say so at the desk, and refusing the correction is
                how the school keeps posting to the old house.

                Never required. CLAUDE.md's "blank is always allowed" is written
                about the CNIC and the reasoning transfers whole — a clerk who
                cannot get past a required field invents an answer, and an
                invented address on a fee notice is worse than an absent one.
              */}
              <div className="sm:col-span-2">
                <AddressAutocomplete
                  label="Home address"
                  value={guardian.location}
                  disabled={fieldsDisabled}
                  multiline
                  hint="Optional. Where the school would post a letter."
                  onChange={(next) => {
                    update(index, { location: next });
                  }}
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
                <input
                  type="radio"
                  name="primary-guardian"
                  className="h-4 w-4"
                  checked={guardian.isPrimaryContact}
                  disabled={fieldsDisabled}
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
