'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { availableRelationships } from '@/components/admissions/GuardianForm';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { CnicField } from '@/components/ui/CnicField';
import { Input } from '@/components/ui/Input';
import { PhoneField } from '@/components/ui/PhoneField';
import { Select } from '@/components/ui/Select';
import {
  GUARDIAN_RELATIONSHIP_LABELS,
  relationshipLabel,
  type GuardianRelationship,
} from '@/db/schema/student-guardians';
import { cnicProblem } from '@/lib/national-id';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The guardians on a student's profile, their parent portal accounts, and the
 * manual GHL re-sync.
 *
 * Both manual actions live here rather than in a settings screen because this
 * is where an admin notices the problem: a guardian showing "Not in GHL" is
 * exactly the row whose WhatsApp will not arrive, and one showing "Welcome not
 * sent" is exactly the parent who is about to ring and say they cannot log in.
 *
 * ── The three portal states, and why they are three ──────────────────────
 * "No portal account" used to be the only thing this panel could say, and it
 * was true of every guardian in the system, and nothing on screen suggested it
 * was a state anybody could leave. It is now split:
 *
 *   * **Portal account** — they have one and the welcome was queued.
 *   * **Welcome not sent** — the account exists or can, and the message has
 *     not gone. Usually because the admission fee has not cleared, which is
 *     working as designed and says so.
 *   * **No email address** — nothing can be sent, and the fix is to add one.
 *
 * The distinction matters because only the third is the school's to act on and
 * only the second is worth a button.
 */

export interface GuardianItem {
  id: string;
  name: string;
  relationship: GuardianRelationship;
  relationshipOther: string | null;
  phone: string;
  email: string | null;
  cnic: string | null;
  occupation: string | null;
  isPrimaryContact: boolean;
  ghlContactId: string | null;
  schoolUserId: string | null;
  /** ISO string. Null = still owed a parent portal welcome. */
  welcomeEmailSentAt: string | null;
}

export interface GuardianPanelProps {
  studentProfileId: string;
  guardians: readonly GuardianItem[];
  maxGuardians: number;
  canEdit: boolean;
  /** Null when the student has not been mirrored into GHL yet. */
  studentGhlContactId: string | null;
  /**
   * True while the admission fee is outstanding.
   *
   * The welcome is held back until it clears, so the panel says which of the
   * two reasons a guardian has not been written to — the fee, or a missing
   * address. Without it "Welcome not sent" reads as a fault.
   */
  awaitingFee?: boolean;
}

export function GuardianPanel({
  studentProfileId,
  guardians,
  maxGuardians,
  canEdit,
  studentGhlContactId,
  awaitingFee = false,
}: GuardianPanelProps) {
  const router = useRouter();

  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState<GuardianRelationship>('mother');
  const [relationshipOther, setRelationshipOther] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cnic, setCnic] = useState('');
  const [occupation, setOccupation] = useState('');
  /** Children this CNIC is already recorded against. */
  const [family, setFamily] = useState<
    { studentProfileId: string; studentId: string; name: string }[]
  >([]);

  /**
   * What the new guardian may be recorded as.
   *
   * The same rule the enrolment form applies, fed the guardians already on this
   * student: Father and Mother each disappear once they are taken, and a
   * student with no guardian at all cannot be given an "Other" as their first
   * one. `availableRelationships` is shared with the enrolment form so the two
   * screens cannot disagree.
   */
  const relationshipChoices = availableRelationships(
    [...guardians.map((guardian) => ({ relationship: guardian.relationship })), {
      relationship,
    }],
    guardians.length,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'add' | 'sync' | string | null>(null);

  /**
   * Fill the form in from a guardian this school already holds.
   *
   * The same call the enrolment form makes. It matters more here, if anything:
   * this is the panel an admin opens when a second parent turns up months
   * after the admission, and it is the moment at which a family already in the
   * system gets a second, unrelated record instead.
   */
  const lookUpCnic = async (value: string): Promise<void> => {
    try {
      const result = await schoolFetch<{
        guardian: {
          name: string;
          phone: string;
          email: string | null;
          occupation: string | null;
        } | null;
        students: { studentProfileId: string; studentId: string; name: string }[];
      }>(`/api/school/guardians/lookup?cnic=${encodeURIComponent(value)}`);

      setFamily(result.students);

      const found = result.guardian;
      if (found === null) return;

      // Only what is still blank. The admin is looking at the person; the
      // database is looking at what was true last time somebody was.
      setName((current) => (current.trim() === '' ? found.name : current));
      setPhone((current) => (current.trim() === '' ? found.phone : current));
      setEmail((current) => (current.trim() === '' ? (found.email ?? '') : current));
      setOccupation((current) =>
        current.trim() === '' ? (found.occupation ?? '') : current,
      );
    } catch {
      // Never an error box: a failed lookup leaves the admin typing by hand,
      // which is what they did before this existed.
      setFamily([]);
    }
  };

  const addGuardian = async (): Promise<void> => {
    setBusy('add');
    setError(null);

    try {
      await schoolFetch(`/api/school/students/${studentProfileId}/guardians`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          relationship,
          relationshipOther,
          phone,
          email,
          cnic,
          occupation,
          isPrimaryContact: false,
        }),
      });

      setIsAdding(false);
      setName('');
      setRelationshipOther('');
      setPhone('');
      setEmail('');
      setCnic('');
      setOccupation('');
      setFamily([]);
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

  /**
   * `force` re-sends to somebody already stamped as welcomed. Two buttons
   * rather than one so the common case — "she never got one" — cannot
   * accidentally spam a parent who did, and the rarer "send it again" is still
   * one click when a parent rings to say nothing arrived.
   */
  const sendPortalInvite = async (
    guardianId: string,
    force: boolean,
  ): Promise<void> => {
    setBusy(guardianId);
    setError(null);
    setNotice(null);

    try {
      const result = await schoolFetch<{ emailQueued: boolean; reason: string | null }>(
        `/api/school/students/${studentProfileId}/guardians/${guardianId}/portal-invite${
          force ? '?force=true' : ''
        }`,
        { method: 'POST' },
      );

      if (result.emailQueued) {
        setNotice(
          'The parent portal welcome is queued. It carries a link to set a password, and expires in 48 hours.',
        );
      } else {
        // Not an error box. "She has no email address on file" is an answer,
        // and colouring it red would be a lie about whose problem it is.
        setNotice(
          result.reason ??
            'That guardian already has a portal account and has been welcomed.',
        );
      }

      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not send the portal invite.'));
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
        {awaitingFee ? (
          <p className="mb-4 rounded-lg bg-status-info-subtle px-3 py-2 text-sm text-status-info-onSubtle">
            This student&rsquo;s admission fee has not been paid yet. Their
            enrolment is recorded, and the parent portal welcome goes out on its
            own the moment the fee clears — there is nothing to press here.
          </p>
        ) : null}

        <ul className="divide-y divide-line">
          {guardians.map((guardian) => (
            <li key={guardian.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {guardian.name}{' '}
                  <span className="text-sm font-normal text-ink-muted">
                    · {relationshipLabel(guardian)}
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
                  {guardian.email === null || guardian.email === '' ? (
                    <Badge variant="warning">No email address</Badge>
                  ) : guardian.welcomeEmailSentAt === null ? (
                    <Badge variant="neutral">
                      {awaitingFee ? 'Welcome held — fee due' : 'Welcome not sent'}
                    </Badge>
                  ) : (
                    <Badge variant="success">Parent portal account</Badge>
                  )}
                  <Badge variant={guardian.ghlContactId === null ? 'warning' : 'neutral'}>
                    {guardian.ghlContactId === null ? 'Not in GHL' : 'In GHL'}
                  </Badge>
                </div>
              </div>

              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  {guardian.email === null || guardian.email === '' ? null : (
                    <Button
                      size="sm"
                      variant={guardian.welcomeEmailSentAt === null ? 'secondary' : 'ghost'}
                      isLoading={busy === guardian.id}
                      onClick={() => {
                        void sendPortalInvite(
                          guardian.id,
                          guardian.welcomeEmailSentAt !== null,
                        );
                      }}
                    >
                      {guardian.welcomeEmailSentAt === null
                        ? 'Send portal invite'
                        : 'Resend invite'}
                    </Button>
                  )}
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
            {/*
              The CNIC leads here for the same reason it leads on the enrolment
              form: it is what decides whether this is a new person or one the
              school already holds, and asking for it after the name is asking
              for it after that decision has been made.
            */}
            <div className="sm:col-span-2">
              <CnicField
                value={cnic}
                disabled={busy === 'add'}
                hint="Enter this first — if this guardian already has a child here, the rest fills itself in."
                onChange={setCnic}
                onComplete={(value) => {
                  void lookUpCnic(value);
                }}
              />
            </div>

            {family.length > 0 ? (
              <div className="rounded-lg bg-status-info-subtle px-3 py-2.5 text-sm text-status-info-onSubtle sm:col-span-2">
                <p className="font-medium">
                  Already a guardian of{' '}
                  {family.length === 1
                    ? 'one student'
                    : `${String(family.length)} students`}{' '}
                  at this school:
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {family.map((child) => (
                    <li key={child.studentProfileId}>
                      {child.name} ·{' '}
                      <span className="font-mono">{child.studentId}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

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
              options={relationshipChoices.map((value) => ({
                value,
                label: GUARDIAN_RELATIONSHIP_LABELS[value],
              }))}
              hint={
                guardians.length === 0
                  ? 'The first guardian is the person the school holds responsible.'
                  : undefined
              }
              value={relationship}
              disabled={busy === 'add'}
              onChange={(event) => {
                setRelationship(event.target.value as GuardianRelationship);
              }}
            />

            {relationship === 'other' ? (
              <div className="sm:col-span-2">
                <Input
                  label="Relation with this student"
                  required
                  placeholder="e.g. Paternal uncle, sponsor, elder cousin"
                  hint="&ldquo;Other&rdquo; on its own tells a teacher ringing this number nothing."
                  value={relationshipOther}
                  disabled={busy === 'add'}
                  onChange={(event) => {
                    setRelationshipOther(event.target.value);
                  }}
                />
              </div>
            ) : null}

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
              hint="Needed to open a parent portal account for this guardian."
              value={email}
              disabled={busy === 'add'}
              onChange={(event) => {
                setEmail(event.target.value);
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
                disabled={
                  name.trim() === '' ||
                  phone.trim() === '' ||
                  cnicProblem(cnic) !== null ||
                  (relationship === 'other' && relationshipOther.trim() === '')
                }
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
