'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Textarea } from '@/components/ui/Textarea';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Write once, reach a class.
 *
 * ── What the thirty people actually get ──────────────────────────────────
 * Thirty **separate** conversations, one each, private between the sender and
 * that person. Not a group. Nobody sees who else received it, and replies come
 * back individually — which is what a teacher asking a class a question wants,
 * and the only shape the schema can hold: a second pupil in one conversation is
 * a `23505` by design.
 *
 * The screen says so in a sentence, because a teacher who believes they have
 * made a group chat will write a different message than one who knows they have
 * written to thirty people separately.
 *
 * ── Skips are reported by name ───────────────────────────────────────────
 * A pupil under a live ban, an account switched off between the picker
 * rendering and Send being pressed — the send proceeds and says who it missed.
 * A broadcast to thirty that fails because one of them is banned is a screen a
 * teacher would fight rather than use.
 */

export interface BroadcastSection {
  sectionId: string;
  label: string;
}

interface BroadcastResponse {
  broadcastId: string;
  sent: number;
  skipped: { name: string; reason: string }[];
}

interface RosterStudent {
  studentProfileId: string;
  name: string;
}

export interface BroadcastComposerProps {
  sections: BroadcastSection[];
  /** Called after a successful send so the inbox picks up the new threads. */
  onSent?: () => void;
}

export function BroadcastComposer({ sections, onSent }: BroadcastComposerProps) {
  const [open, setOpen] = useState(false);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [roster, setRoster] = useState<RosterStudent[]>([]);

  const [includeStudents, setIncludeStudents] = useState(true);
  const [includeParents, setIncludeParents] = useState(false);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BroadcastResponse | null>(null);

  /*
   * The roster behind the "or pick individuals" list. Fetched only for the
   * sections already chosen, so choosing nothing fetches nothing — a teacher
   * with six classes should not pull two hundred names to send to one of them.
   */
  useEffect(() => {
    if (sectionIds.length === 0) {
      setRoster([]);
      setStudentIds([]);
      return;
    }

    void (async () => {
      try {
        const query = sectionIds.map((id) => `sectionId=${encodeURIComponent(id)}`).join('&');
        const response = await schoolFetch<{ students: RosterStudent[] }>(
          `/api/school/chat/broadcast-roster?${query}`,
        );
        setRoster(response.students);
      } catch {
        setRoster([]);
      }
    })();
  }, [sectionIds]);

  const send = useCallback(async () => {
    if (busy) return;

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const response = await schoolFetch<BroadcastResponse>('/api/school/chat/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          sectionIds: studentIds.length > 0 ? [] : sectionIds,
          studentProfileIds: studentIds,
          includeStudents,
          includeParents,
          subject: subject.trim() === '' ? null : subject.trim(),
          body: body.trim(),
        }),
      });

      setResult(response);
      setBody('');
      setSubject('');
      onSent?.();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That message could not be sent.'));
    } finally {
      setBusy(false);
    }
  }, [busy, sectionIds, studentIds, includeStudents, includeParents, subject, body, onSent]);

  if (sections.length === 0) return null;

  return (
    <section className="rounded-card border border-line bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Message a whole class</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Write once. Everyone you pick gets their own private conversation with you —
            they cannot see each other, and each can reply to you separately.
          </p>
        </div>
        <Button
          variant={open ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => {
            setOpen((was) => !was);
            setError(null);
            setResult(null);
          }}
        >
          {open ? 'Cancel' : 'Write to a class'}
        </Button>
      </div>

      {error !== null ? (
        <p
          role="alert"
          className="mt-3 rounded-card bg-status-danger-soft px-3 py-2 text-sm text-status-danger-onSoft"
        >
          {error}
        </p>
      ) : null}

      {result !== null ? (
        <div className="mt-3 rounded-card bg-surface px-3 py-2 text-sm text-ink">
          <p>
            Sent to <strong>{result.sent}</strong>{' '}
            {result.sent === 1 ? 'person' : 'people'}.
          </p>
          {result.skipped.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-ink-muted">
              {result.skipped.map((skip) => (
                <li key={skip.name}>
                  <strong>{skip.name}</strong> — {skip.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="mt-4 space-y-3">
          <MultiSelect
            label="Classes"
            options={sections.map((section) => ({
              value: section.sectionId,
              label: section.label,
            }))}
            value={sectionIds}
            onChange={setSectionIds}
          />

          {roster.length > 0 ? (
            <>
              <MultiSelect
                label="Or just these students (leave empty for the whole class)"
                options={roster.map((student) => ({
                  value: student.studentProfileId,
                  label: student.name,
                }))}
                value={studentIds}
                onChange={setStudentIds}
              />
              {studentIds.length > 0 ? (
                <p className="text-xs text-ink-muted">
                  {studentIds.length} student{studentIds.length === 1 ? '' : 's'} selected —
                  the class selection above is ignored while any are ticked.
                </p>
              ) : null}
            </>
          ) : null}

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={includeStudents}
                onChange={(event) => {
                  setIncludeStudents(event.target.checked);
                }}
                className="h-4 w-4 rounded border-line-strong"
              />
              The students
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={includeParents}
                onChange={(event) => {
                  setIncludeParents(event.target.checked);
                }}
                className="h-4 w-4 rounded border-line-strong"
              />
              Their parents
            </label>
          </div>

          <Input
            label="Subject (optional)"
            value={subject}
            maxLength={140}
            onChange={(event) => {
              setSubject(event.target.value);
            }}
          />

          <Textarea
            label="Message"
            rows={4}
            maxLength={2000}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />

          <div className="flex justify-end">
            <Button
              onClick={() => void send()}
              disabled={
                busy ||
                body.trim() === '' ||
                (sectionIds.length === 0 && studentIds.length === 0) ||
                (!includeStudents && !includeParents)
              }
            >
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
