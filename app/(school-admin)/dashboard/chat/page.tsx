import type { Metadata } from 'next';
import Link from 'next/link';

import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { OVERSIGHT_NOTICE } from '@/lib/chat-oversight';
import { PageHeader } from '@/components/ui/PageHeader';
import { callerHasPermission, requireSchoolPermission } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Chat',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Chat, from the admin portal.
 *
 * Gated on `chat.read` rather than by role, because this is the one portal
 * where a school may genuinely want to take chat away from somebody — an
 * accountant who should be answering vouchers rather than messages. The parent,
 * pupil and teacher portals are role-gated instead: a toggle that removed a
 * parent's inbox is one no administrator has a reason to touch.
 *
 * Sprint 26 adds a second link beside it. `chat.oversight` opens *All
 * conversations* — the correspondence itself rather than the things somebody
 * complained about — and the two are separate permissions because they are
 * separate acts: one is a safeguarding investigation, the other is a head
 * reading what their school is saying.
 *
 * The link to the moderation queue is rendered only for `chat.moderate`, which
 * is a narrower grant on purpose: opening a class is a teacher's ordinary work,
 * reading a pupil's conversations is what a safeguarding complaint comes back
 * to, and the two should not arrive together by default.
 */
export default async function AdminChatPage() {
  const { claims, locationId } = await requireSchoolPermission('chat.read');
  const me = await getSchoolUserByUid(locationId, claims.uid);
  const canModerate = await callerHasPermission('chat.moderate');
  const canOversee = await callerHasPermission('chat.oversight');

  if (me === null) {
    return (
      <div className="space-y-6">
        <PageHeader title="Chat" />
        <p className="text-sm text-ink-muted">No account at this school.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chat"
        description="Parents, staff and students."
        actions={
          <span className="flex flex-wrap items-center gap-4">
            {canOversee ? (
              <Link
                href="/dashboard/chat/oversight"
                className="text-sm font-medium text-brand-primary hover:underline"
              >
                All conversations
              </Link>
            ) : null}
            {canModerate ? (
              <Link
                href="/dashboard/chat/moderation"
                className="text-sm font-medium text-brand-primary hover:underline"
              >
                Reported messages
              </Link>
            ) : null}
          </span>
        }
      />

      <ChatWorkspace
        meId={me.id}
        canAttach
        canInitiate
        auditNotice={OVERSIGHT_NOTICE}
        emptyMessage="Nothing yet. Start a conversation with a parent, a colleague or a student."
      />
    </div>
  );
}
