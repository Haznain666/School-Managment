'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PhoneField } from '@/components/ui/PhoneField';
import { Select } from '@/components/ui/Select';
import {
  GUARDIAN_RELATIONSHIPS,
  GUARDIAN_RELATIONSHIP_LABELS,
  type GuardianRelationship,
} from '@/db/schema/student-guardians';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The guardians on a student's profile, plus the manual GHL re-sync.
 *
 * The re-sync lives here rather than in a settings screen because this is where
 * an admin notices the problem: a guardian showing "Not in GHL" is exactly the
 * row whose WhatsApp will not arrive.
 */

export interface GuardianItem {
  id: string;
  name: string;
  relationship: GuardianRelationship;
  phone: string;
  email: string | null;
  cnic: string | null;
  occupation: string | null;
  isPrimaryContact: boolean;
  ghlContactId: string | null;
  schoolUserId: string | null;
}

export interface GuardianPanelProps {
  studentProfileId: string;
  guardians: readonly GuardianItem[];
  maxGuardians: number;
  canEdit: boolean;
  /** Null when the student has not been mirrored into GHL yet. */
  studentGhlContactId: string | null;
}

const RELATIONSHIP_OPTIONS = GUARDIAN_RELATIONSHIPS.map((value) => ({
  value,
  label: GUARDIAN_RELATIONSHIP_LABELS[value],
}));

export function GuardianPanel({
  studentProfileId,
  guardians,
  maxGuardians,
  canEdit,
  studentGhlContactId,
}: GuardianPanelProps) {
  const router = useRouter();

  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState<GuardianRelationship>('mother');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cnic, setCnic] = useState('');
  const [occupation, setOccupation] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'add' | 'sync' | string | null>(null);

  const addGuardian = async (): Promise<void> => {
    setBusy('add');
    setError(null);

    try {
      await schoolFetch(`/api/school/students/${studentProfileId}/guardians`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          relationship,
          phone,
          email,
          cnic,
          occupation,
          isPrimaryContact: false,
        }),
      });

      setIsAdding(false);
      setName('');
      setPhone('');
      setEmail('');
      setCnic('');
      setOccupation('');
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not add the guardian.'));
    } finally {
      setBusy(null);
    }
  };

  const removeGuardian = async (guardianId: string): Promise<void> => {
    setBusy(guardianId);
    setError(null);

    try {
      await schoolFetch(
        `/api/school/students/${studentProfileId}/guardians/${guardianId}`,
        { method: 'DELETE' },
      );
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not remove the guardian.'));
    } finally {
      setBusy(null);
    }
  };

  const makePrimary = async (guardianId: string): Promise<void> => {
    setBusy(guardianId);
    setError(null);

    try {
      await schoolFetch(
        `/api/school/students/${studentProfileId}/guardians/${guardianId}`,
        { method: 'PATCH', body: JSON.stringify({ isPrimaryContact: true }) },
      );
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not change the primary contact.'));
    } finally {
      setBusy(null);
    }
  };

  const syncGhl = async (): Promise<void> => {
    setBusy('sync');
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{
        synced: boolean;
        guardianContactIds: string[];
      }>(`/api/school/students/${studentProfileId}/sync-ghl`, { method: 'POST' });

      setNotice(
        result.synced
          ? `Synced to GoHighLevel: the student and ${result.guardianContactIds.length} guardian${
              result.guardianContactIds.length === 1 ? '' : 's'
            }.`
          : 'Nothing could be synced. Check that this school’s GoHighLevel connection is active.',
      );
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The GoHighLevel sync failed.'));
    } finally {
      setBusy(null);
    }
  };

  const unsynced =
    studentGhlContactId === null ||
    guardians.some((guardian) => guardian.ghlContactId === null);

  return (
    <div className="space-y-4">
      <Card
        header={
          <CardTitle
            title="Guardians"
            description="Who the school contacts about this student."
            action={
              canEdit && !isAdding && guardians.length < maxGuardians ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setIsAdding(true);
                  }}
                >
                  Add guardian
                </Button>
              ) : undefined
            }
          />
        }
      >
        <ul className="divide-y divide-line">
          {guardians.map((guardian) => (
            <li key={guardian.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {guardian.name}{' '}
                  <span className="text-sm font-normal text-ink-muted">
                    · {GUARDIAN_RELATIONSHIP_LABELS[guardian.relationship]}
                  </span>
                </p>
                <p className="font-mono text-xs text-ink-muted">{guardian.phone}</p>
                {guardian.email === null ? null : (
                  <p className="text-xs text-ink-muted">{guardian.email}</p>
                )}
                {guardian.occupation === null ? null : (
                  <p className="text-xs text-ink-muted">{guardian.occupation}</p>
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  {guardian.isPrimaryContact ? (
                    <Badge variant="success">Primary contact</Badge>
                  ) : null}
                  {guardian.schoolUserId === null ? (
                    <Badge variant="neutral">No portal account</Badge>
                  ) : (
                    <Badge variant="success">Portal account linked</Badge>
                  )}
                  <Badge variant={guardian.ghlContactId === null ? 'warning' : 'neutral'}>
                    {guardian.ghlContactId === null ? 'Not in GHL' : 'In GHL'}
                  </Badge>
                </div>
              </div>

              {canEdit ? (
                <div className="flex gap-2">
                  {guardian.isPrimaryContact ? null : (
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={busy === guardian.id}
                      onClick={() => {
                        void makePrimary(guardian.id);
                      }}
                    >
                      Make primary
                    </Button>
                  )}
                  {guardians.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={busy === guardian.id}
                      onClick={() => {
                        void removeGuardian(guardian.id);
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {isAdding ? (
          <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <Input
              label="Full name"
              required
              value={name}
              disabled={busy === 'add'}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <Select
              label="Relationship"
              options={RELATIONSHIP_OPTIONS}
              value={relationship}
              disabled={busy === 'add'}
              onChange={(event) => {
                setRelationship(event.target.value as GuardianRelationship);
              }}
            />
            <PhoneField
              label="Phone"
              required
              // Identity — see the same field on `GuardianForm`.
              identity
              value={phone}
              disabled={busy === 'add'}
              onChange={setPhone}
            />
            <Input
              label="Email"
              type="email"
              value={email}
              disabled={busy === 'add'}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
            <Input
              label="CNIC"
              value={cnic}
              disabled={busy === 'add'}
              onChange={(event) => {
                setCnic(event.target.value);
              }}
            />
            <Input
              label="Occupation"
              value={occupation}
              disabled={busy === 'add'}
              onChange={(event) => {
                setOccupation(event.target.value);
              }}
            />

            <div className="flex gap-3 sm:col-span-2">
              <Button
                isLoading={busy === 'add'}
                disabled={name.trim() === '' || phone.trim() === ''}
                onClick={() => {
                  void addGuardian();
                }}
              >
                Add guardian
              </Button>
              <Button
                variant="secondary"
                disabled={busy === 'add'}
                onClick={() => {
                  setIsAdding(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card header={<CardTitle title="GoHighLevel sync" />}>
        <p className="text-sm text-ink-muted">
          {unsynced
            ? 'Some records have not reached GoHighLevel. Enrolment never fails because of a CRM outage, so this can be re-run at any time.'
            : 'This student and every guardian have a GoHighLevel contact.'}
        </p>

        {studentGhlContactId === null ? null : (
          <p className="mt-2 font-mono text-xs text-ink-muted">
            Student contact: {studentGhlContactId}
          </p>
        )}

        {canEdit ? (
          <Button
            className="mt-4"
            variant={unsynced ? 'primary' : 'secondary'}
            isLoading={busy === 'sync'}
            onClick={() => {
              void syncGhl();
            }}
          >
            {unsynced ? 'Sync now' : 'Re-sync'}
          </Button>
        ) : null}

        {notice !== null ? (
          <p className="mt-3 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-onSubtle">
            {notice}
          </p>
        ) : null}

        {error !== null ? (
          <p role="alert" className="mt-3 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
