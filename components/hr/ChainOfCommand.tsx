'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Select } from '@/components/ui/Select';
import { SkeletonForm } from '@/components/ui/Skeleton';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';
import { ROLE_LABELS, type UserRole } from '@/types/school-auth';

/**
 * The chain of command — who each section head runs, and who is missing.
 *
 * ── Per campus: Principal → Vice Principal → Section Heads → Coordinators ─
 * Two of those rungs are already stored. `coordinator_teachers` has said which
 * teachers a coordinator supervises since Sprint 32 and is reused unchanged;
 * the heads are resolved from `school_users.branch_id`. What was missing is the
 * rung between them, which is what this screen writes.
 *
 * ── The duplicate report, and why it is on this screen ───────────────────
 * Decision 2 allows one Principal and one Vice Principal per campus, and `0047`
 * creates the indexes that make that a fact **only at a school with no
 * duplicate already** — a migration that fails on live data stops every other
 * statement in the file. So a school that already has two is told here, by
 * name, on the screen of the person who can resolve it. Nothing is ever
 * deleted: one of those two rows is somebody who signs in every morning.
 */

interface ChainPerson {
  userId: string;
  name: string;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
}

interface SetupPayload {
  sectionHeads: Array<ChainPerson & { coordinatorUserIds: string[] }>;
  coordinators: Array<ChainPerson & { sectionHeadUserId: string | null }>;
  duplicateHeads: Array<{ role: UserRole; branchId: string | null; names: string[] }>;
}

export interface ChainOfCommandProps {
  /** False for somebody who may read the chain but not change it. */
  canEdit: boolean;
}

export function ChainOfCommand({ canEdit }: ChainOfCommandProps) {
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [headId, setHeadId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPending(true);
    try {
      const payload = await schoolFetch<{ setup: SetupPayload }>('/api/school/chain/section-heads');
      setSetup(payload.setup);
      setHeadId((held) => (held === '' ? (payload.setup.sectionHeads[0]?.userId ?? '') : held));
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the reporting line.'));
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const head = setup?.sectionHeads.find((row) => row.userId === headId) ?? null;

  useEffect(() => {
    setPicked(head?.coordinatorUserIds ?? []);
  }, [head]);

  // A reporting line belongs to one campus, so only that campus's coordinators
  // are offered. The server refuses the rest again on the write.
  const offered = (setup?.coordinators ?? []).filter(
    (row) => head !== null && row.branchId === head.branchId,
  );

  const save = async (): Promise<void> => {
    if (head === null) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const payload = await schoolFetch<{ setup: SetupPayload }>('/api/school/chain/section-heads', {
        method: 'PUT',
        body: JSON.stringify({ sectionHeadUserId: head.userId, coordinatorUserIds: picked }),
      });
      setSetup(payload.setup);
      setNotice(
        picked.length === 0
          ? `${head.name} now runs no coordinators. Their leave will go to the Vice Principal and above.`
          : `${head.name} now runs ${String(picked.length)} coordinator${picked.length === 1 ? '' : 's'}.`,
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the reporting line.'));
    } finally {
      setBusy(false);
    }
  };

  if (pending && setup === null) return <SkeletonForm fields={3} columns={1} />;

  return (
    <div className="space-y-6">
      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      {(setup?.duplicateHeads.length ?? 0) === 0 ? null : (
        <Card
          header={
            <CardTitle
              title="More than one head at a campus"
              description="Your school is meant to have one Principal and one Vice Principal per campus. Nothing has been changed or removed — deciding which is which is a person's job, not a migration's."
            />
          }
        >
          <ul className="space-y-2 text-sm">
            {setup?.duplicateHeads.map((row) => (
              <li
                key={`${row.role}-${row.branchId ?? 'school'}`}
                className="rounded-lg bg-status-warning-subtle px-3 py-2 text-status-warning-ink"
              >
                <span className="font-medium">{ROLE_LABELS[row.role]}</span>
                {row.branchId === null ? ' (school-wide)' : ''}: {row.names.join(', ')}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        header={
          <CardTitle
            title="Section heads and their coordinators"
            description={
              canEdit
                ? 'Choose the coordinators each section head runs, at the section head’s own campus. Their leave comes to that section head first.'
                : 'Which coordinators each section head runs. Somebody who manages leave makes these assignments.'
            }
          />
        }
      >
        {(setup?.sectionHeads.length ?? 0) === 0 ? (
          <p className="text-sm text-ink-muted">
            No section heads yet. Invite one from Users &amp; Staff — the role is
            &ldquo;Section Head&rdquo; — and they will appear here. A school with none
            simply has one fewer rung: leave goes from the coordinator to the Vice
            Principal.
          </p>
        ) : (
          <div className="space-y-4">
            <Select
              label="Section head"
              value={headId}
              options={(setup?.sectionHeads ?? []).map((row) => ({
                value: row.userId,
                label: `${row.name}${row.branchName === null ? '' : ` — ${row.branchName}`}`,
              }))}
              onChange={(event) => {
                setHeadId(event.target.value);
              }}
            />

            {head === null ? null : head.branchId === null ? (
              <p className="text-sm text-ink-muted">
                {head.name} has no campus yet. Set it in Users &amp; Staff first — a
                reporting line belongs to a campus.
              </p>
            ) : (
              <>
                <MultiSelect
                  label="Coordinators they run"
                  value={picked}
                  options={offered.map((row) => ({
                    value: row.userId,
                    label:
                      row.sectionHeadUserId === null || row.sectionHeadUserId === head.userId
                        ? row.name
                        : `${row.name} (currently under somebody else)`,
                  }))}
                  emptyMessage={`No coordinators at ${head.branchName ?? 'that campus'} yet.`}
                  disabled={!canEdit}
                  onChange={setPicked}
                />

                {canEdit ? (
                  <Button
                    isLoading={busy}
                    onClick={() => {
                      void save();
                    }}
                  >
                    Save reporting line
                  </Button>
                ) : null}
              </>
            )}
          </div>
        )}
      </Card>

      <Card header={<CardTitle title="Coordinators without a section head" />}>
        {(() => {
          const orphans = (setup?.coordinators ?? []).filter(
            (row) => row.sectionHeadUserId === null,
          );

          return orphans.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Every coordinator reports to a section head.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-ink-muted">
                Their leave goes straight to the Vice Principal and above, which is
                correct for a school with no section heads and is worth checking for one
                that has them.
              </p>
              <ul className="flex flex-wrap gap-2">
                {orphans.map((row) => (
                  <li key={row.userId} className="rounded-lg border border-line px-3 py-2 text-sm">
                    <span className="font-medium text-ink">{row.name}</span>
                    {row.branchName === null ? null : (
                      <span className="ml-2 text-ink-muted">{row.branchName}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          );
        })()}
      </Card>
    </div>
  );
}
