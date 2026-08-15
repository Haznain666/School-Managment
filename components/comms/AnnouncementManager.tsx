'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Toggle } from '@/components/ui/Toggle';
import {
  ANNOUNCEMENT_STATUS_LABELS,
  type AnnouncementAudience,
  type AnnouncementStatus,
} from '@/db/schema';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Writing an announcement, and releasing it.
 *
 * ── Why sending is its own confirmed action ──────────────────────────────
 * Everything else on this screen can be undone by editing. Sending cannot: a
 * notice appears in front of every parent it is addressed to, and the email run
 * behind it leaves an outbox that has no recall. So it is a separate button
 * behind a confirmation that states the size of the audience, and it is hidden
 * entirely from somebody who only holds `comms.write`.
 *
 * ── Why the screen says "queued" and never "sent" for email ──────────────
 * The send returns what was accepted into the outbox, not what was delivered —
 * `STATE.md` §5k. A screen that reported delivery it cannot know about is the
 * lie the outbox was built to stop telling.
 */

export interface AnnouncementRowView {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  branchId: string | null;
  branchName: string | null;
  status: AnnouncementStatus;
  sendEmail: boolean;
  scheduledAt: string | null;
  sentAt: string | null;
  authorName: string | null;
  recipientCount: number;
}

export interface AudienceOption {
  id: string;
  label: string;
}

export interface AnnouncementManagerProps {
  announcements: readonly AnnouncementRowView[];
  branches: readonly AudienceOption[];
  grades: readonly AudienceOption[];
  sections: readonly AudienceOption[];
  roles: readonly AudienceOption[];
  canWrite: boolean;
  canSend: boolean;
}

const STATUS_VARIANTS: Record<AnnouncementStatus, BadgeVariant> = {
  draft: 'neutral',
  scheduled: 'warning',
  sent: 'success',
};

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

type AudienceKindChoice = 'all' | 'roles' | 'grades' | 'sections';

const AUDIENCE_CHOICES = [
  { value: 'all', label: 'Everyone at the school' },
  { value: 'roles', label: 'People in a role' },
  { value: 'grades', label: 'Classes' },
  { value: 'sections', label: 'Sections' },
] as const;

export function AnnouncementManager({
  announcements,
  branches,
  grades,
  sections,
  roles,
  canWrite,
  canSend,
}: AnnouncementManagerProps) {
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<AudienceKindChoice>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [branchId, setBranchId] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const options =
    kind === 'roles' ? roles : kind === 'grades' ? grades : kind === 'sections' ? sections : [];

  const reset = (): void => {
    setTitle('');
    setBody('');
    setKind('all');
    setPicked([]);
    setBranchId('');
    setSendEmail(false);
    setScheduledAt('');
  };

  const audience = (): AnnouncementAudience =>
    kind === 'all'
      ? { kind: 'all' }
      : kind === 'roles'
        ? { kind: 'roles', roles: picked }
        : kind === 'grades'
          ? { kind: 'grades', gradeIds: picked }
          : { kind: 'sections', sectionIds: picked };

  const create = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);

    try {
      await schoolFetch('/api/school/announcements', {
        method: 'POST',
        body: JSON.stringify({
          title,
          body,
          audience: audience(),
          branchId: branchId === '' ? null : branchId,
          sendEmail,
          scheduledAt: scheduledAt === '' ? null : new Date(scheduledAt).toISOString(),
        }),
      });

      setIsOpen(false);
      reset();
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The announcement could not be saved.'));
    } finally {
      setIsSaving(false);
    }
  };

  const send = async (row: AnnouncementRowView): Promise<void> => {
    // The count is stated before the irreversible thing happens, not after.
    // "Send to everyone" and "send to 1,240 people" are the same instruction
    // and a very different decision.
    const confirmed = window.confirm(
      `Send "${row.title}" now?${
        row.sendEmail ? ' It will also be emailed to everyone it reaches.' : ''
      }\n\nThis cannot be undone.`,
    );
    if (!confirmed) return;

    setBusyId(row.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/announcements/${row.id}/send`, { method: 'POST' });
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'It could not be sent.'));
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (row: AnnouncementRowView): Promise<void> => {
    if (!window.confirm(`Discard "${row.title}"?`)) return;

    setBusyId(row.id);
    setError(null);

    try {
      await schoolFetch(`/api/school/announcements/${row.id}`, { method: 'DELETE' });
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'It could not be discarded.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card
      header={
        <CardTitle
          title="Announcements"
          description="What the school has told people, and what it is about to."
          action={
            canWrite ? (
              <Button
                variant={isOpen ? 'secondary' : 'primary'}
                onClick={() => {
                  setIsOpen(!isOpen);
                  setError(null);
                }}
              >
                {isOpen ? 'Cancel' : 'Write an announcement'}
              </Button>
            ) : undefined
          }
        />
      }
    >
      {error === null ? null : (
        <p className="mb-4 rounded-control border border-status-danger-line bg-status-danger-surface px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      )}

      {isOpen ? (
        <div className="mb-6 space-y-4 rounded-card border border-line bg-surface-sunken p-4">
          <Input
            label="Title"
            value={title}
            maxLength={140}
            onChange={(event) => setTitle(event.target.value)}
          />

          <Textarea
            label="Message"
            rows={6}
            value={body}
            maxLength={5000}
            onChange={(event) => setBody(event.target.value)}
            hint="Plain text. The line breaks you type are kept."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Who is it for"
              value={kind}
              options={AUDIENCE_CHOICES}
              onChange={(event) => {
                setKind(event.target.value as AudienceKindChoice);
                setPicked([]);
              }}
            />

            <Select
              label="Campus"
              value={branchId}
              options={[
                { value: '', label: 'Every campus' },
                ...branches.map((branch) => ({ value: branch.id, label: branch.label })),
              ]}
              onChange={(event) => setBranchId(event.target.value)}
              hint="Narrows any audience to one campus."
            />
          </div>

          {kind === 'all' ? null : (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">
                {kind === 'roles' ? 'Roles' : kind === 'grades' ? 'Classes' : 'Sections'}
              </legend>
              <div className="flex flex-wrap gap-2">
                {options.map((option) => {
                  const isPicked = picked.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={isPicked}
                      onClick={() =>
                        setPicked(
                          isPicked
                            ? picked.filter((id) => id !== option.id)
                            : [...picked, option.id],
                        )
                      }
                      className={
                        isPicked
                          ? 'rounded-control border border-brand-primary bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-on-primary'
                          : 'rounded-control border border-line bg-surface-raised px-3 py-1.5 text-sm text-ink hover:border-brand-primary'
                      }
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {options.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  There is nothing to choose from here yet.
                </p>
              ) : null}
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Send at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              hint="Leave empty to keep it as a draft you send by hand."
            />

            <Toggle
              label="Email it as well"
              checked={sendEmail}
              onChange={setSendEmail}
              description="Everyone with an address on their record. The rest are listed as unreachable."
            />
          </div>

          <Button
            onClick={() => void create()}
            disabled={isSaving || title.trim() === '' || body.trim() === ''}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      ) : null}

      {announcements.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing written yet. An announcement reaches the notice board on every
          portal it is addressed to, and optionally people&rsquo;s email.
        </p>
      ) : (
        <ul className="space-y-3">
          {announcements.map((row) => (
            <li
              key={row.id}
              className="rounded-card border border-line bg-surface-raised p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{row.title}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {row.branchName ?? 'Every campus'}
                    {row.authorName === null ? '' : ` · ${row.authorName}`}
                    {row.sentAt === null
                      ? row.scheduledAt === null
                        ? ''
                        : ` · goes out ${DATE.format(new Date(row.scheduledAt))}`
                      : ` · sent ${DATE.format(new Date(row.sentAt))}`}
                    {row.status === 'sent'
                      ? ` · ${row.recipientCount.toLocaleString()} ${
                          row.recipientCount === 1 ? 'person' : 'people'
                        }`
                      : ''}
                  </p>
                </div>

                <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                  <Badge variant={STATUS_VARIANTS[row.status]}>
                    {ANNOUNCEMENT_STATUS_LABELS[row.status]}
                  </Badge>
                  {row.sendEmail ? <Badge variant="neutral">Email</Badge> : null}
                </div>
              </div>

              <p className="mt-2 line-clamp-2 whitespace-pre-line text-sm text-ink-muted">
                {row.body}
              </p>

              {row.status === 'sent' ? null : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canSend ? (
                    <Button
                      size="sm"
                      onClick={() => void send(row)}
                      disabled={busyId === row.id}
                    >
                      {busyId === row.id ? 'Sending…' : 'Send now'}
                    </Button>
                  ) : null}
                  {canWrite ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void discard(row)}
                      disabled={busyId === row.id}
                    >
                      Discard
                    </Button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
