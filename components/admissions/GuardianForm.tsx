'use client';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  GUARDIAN_RELATIONSHIPS,
  GUARDIAN_RELATIONSHIP_LABELS,
  type GuardianRelationship,
} from '@/db/schema/student-guardians';

/** One guardian as the form holds it — phone is still raw user input here. */
export interface GuardianDraft {
  name: string;
  relationship: GuardianRelationship;
  phone: string;
  email: string;
  cnic: string;
  occupation: string;
  isPrimaryContact: boolean;
}

export function emptyGuardian(isPrimaryContact: boolean): GuardianDraft {
  return {
    name: '',
    relationship: 'father',
    phone: '',
    email: '',
    cnic: '',
    occupation: '',
    isPrimaryContact,
  };
}

const RELATIONSHIP_OPTIONS = GUARDIAN_RELATIONSHIPS.map((value) => ({
  value,
  label: GUARDIAN_RELATIONSHIP_LABELS[value],
}));

export interface GuardianFormProps {
  guardians: readonly GuardianDraft[];
  onChange: (guardians: GuardianDraft[]) => void;
  maxGuardians: number;
  disabled?: boolean;
}

/**
 * The guardian step of an enrolment.
 *
 * Exactly one guardian is the primary contact at any moment — the school needs
 * a single number to WhatsApp about fees and absences, so choosing one demotes
 * the rest here rather than leaving the server to guess.
 */
export function GuardianForm({
  guardians,
  onChange,
  maxGuardians,
  disabled = false,
}: GuardianFormProps) {
  const update = (index: number, patch: Partial<GuardianDraft>): void => {
    onChange(
      guardians.map((guardian, position) =>
        position === index ? { ...guardian, ...patch } : guardian,
      ),
    );
  };

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
      {guardians.map((guardian, index) => (
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
              options={RELATIONSHIP_OPTIONS}
              value={guardian.relationship}
              disabled={disabled}
              onChange={(event) => {
                update(index, {
                  relationship: event.target.value as GuardianRelationship,
                });
              }}
            />

            <Input
              label="Phone"
              type="tel"
              required
              placeholder="0300-1234567"
              hint="WhatsApp number — this is how the school will reach you."
              value={guardian.phone}
              disabled={disabled}
              onChange={(event) => {
                update(index, { phone: event.target.value });
              }}
            />

            <Input
              label="Email"
              type="email"
              value={guardian.email}
              disabled={disabled}
              onChange={(event) => {
                update(index, { email: event.target.value });
              }}
            />

            <Input
              label="CNIC"
              placeholder="42101-1234567-1"
              value={guardian.cnic}
              disabled={disabled}
              onChange={(event) => {
                update(index, { cnic: event.target.value });
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
      ))}

      {guardians.length < maxGuardians ? (
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            onChange([...guardians, emptyGuardian(false)]);
          }}
        >
          Add another guardian
        </Button>
      ) : (
        <p className="text-sm text-ink-muted">
          Up to {maxGuardians} guardians can be recorded per student.
        </p>
      )}
    </div>
  );
}
