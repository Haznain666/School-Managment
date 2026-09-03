'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * "Open chat for 7-B for two hours" — the control the brief was built around.
 *
 * ── One row, not thirty ──────────────────────────────────────────────────
 * Opening a class writes **one** `chat_grants` row scoped to the section, not
 * one per pupil. That is not a saving, it is the behaviour: the grant is closed
 * again in one click rather than thirty, and a pupil moved into the section
 * halfway through the window is covered by it without anybody noticing they
 * needed to be.
 *
 * ── The countdown is the point of the screen ─────────────────────────────
 * A teacher who opened a class needs to know it is still open, and a window
 * that expires silently is one nobody trusts. The list refreshes on its own and
 * the remaining time is rendered from `endsAt`, so a tab left open all afternoon
 * still tells the truth.
 *
 * ── What this cannot do ──────────────────────────────────────────────────
 * It cannot open a class the teacher does not teach — `grantScopeProblem`
 * re-derives that from the timetable and refuses — and it cannot lift a ban set
 * by a head, because `granted_by_rank` is compared before specificity. Both
 * refusals arrive as sentences and are rendered verbatim.
 */

const DURATIONS = [
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: '240', label: '4 hours' },
  { value: '480', label: '8 hours' },
];

export interface TeacherSectionOption {
  sectionId: string;
  gradeId: string;
  label: string;
}

interface GrantRow {
  id: string;
  scopeType: string;
  scopeId: string;
  effect: string;
  endsAt: string | null;
  reason: string | null;
}

export interface ClassChatAccessProps {
  sections: TeacherSectionOption[];
}

/** "1h 47m left", from an ISO instant. */
function remaining(endsAt: string | null): string {
  if (endsAt === null) return 'No end time';

  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'Closing';

  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);

  return hours === 0
    ? `${String(minutes)}m left`
    : `${String(hours)}h ${String(minutes % 60)}m left`;
}

export function ClassChatAccess({ sections }: ClassChatAccessProps) {
  const [sectionId, setSectionId] = useState(sections[0]?.sectionId ?? '');
  const [minutes, setMinutes] = useState('120');
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A second value nobody reads, changed on a timer, so the countdown re-renders
  // without refetching. The alternative — polling the grants endpoint every
  // minute — is a request per teacher per minute for a number the browser can
  // work out on its own.
  const [, setTick] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await schoolFetch<{ grants: GrantRow[] }>('/api/school/chat/grants');
      setGrants(
        result.grants.filter(
          (grant) => grant.effect === 'allow' && grant.scopeType === 'section',
        ),
      );
    } catch {
      /* The screen is still usable without the list. */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((value) => value + 1);
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (sections.length === 0) return null;

  async function open(): Promise<void> {
    if (busy || sectionId === '') return;

    setBusy(true);
    setError(null);

    try {
      await schoolFetch('/api/school/chat/grants', {
        method: 'POST',
        body: JSON.stringify({
          scopeType: 'section',
          scopeId: sectionId,
          effect: 'allow',
          minutes: Number(minutes),
        }),
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Chat could not be opened for that class.'));
    } finally {
      setBusy(false);
    }
  }

  async function close(grantId: string): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      await schoolFetch('/api/school/chat/grants', {
        method: 'DELETE',
        body: JSON.stringify({ grantId }),
      });
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That opening could not be closed.'));
    } finally {
      setBusy(false);
    }
  }

  const labelFor = (scopeId: string): string =>
    sections.find((section) => section.sectionId === scopeId)?.label ?? 'A class';

  return (
    <section className="rounded-card border border-line bg-surface-raised p-4">
      <h2 className="text-sm font-semibold text-ink">Let a class message you</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Students can always reply to a message you send them. This lets a whole class
        start one, for a set time.
      </p>

      {error !== null ? (
        <p
          role="alert"
          className="mt-3 rounded-card bg-status-danger-soft px-3 py-2 text-sm text-status-danger-onSoft"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Select
          label="Class"
          value={sectionId}
          options={sections.map((section) => ({
            value: section.sectionId,
            label: section.label,
          }))}
          onChange={(event) => {
            setSectionId(event.target.value);
          }}
        />

        <Select
          label="For"
          value={minutes}
          options={DURATIONS}
          onChange={(event) => {
            setMinutes(event.target.value);
          }}
        />

        <Button onClick={() => void open()} disabled={busy}>
          Open chat
        </Button>
      </div>

      {grants.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {grants.map((grant) => (
            <li
              key={grant.id}
              className="flex items-center justify-between gap-3 rounded-card bg-surface px-3 py-2"
            >
              <span className="text-sm text-ink">
                {labelFor(grant.scopeId)}
                <span className="ml-2 text-xs text-ink-muted">{remaining(grant.endsAt)}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void close(grant.id)}
                disabled={busy}
              >
                Close now
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
