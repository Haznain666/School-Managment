import type { Metadata } from 'next';

import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Messages',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A parent's messages.
 *
 * Who they can reach is derived, not listed: the teachers who actually teach
 * their children this year, plus the school's desks — Accounts, Admissions, the
 * office, the head. A desk is addressed rather than a named clerk, so the
 * thread survives that clerk leaving and whoever is on it can pick it up.
 *
 * This portal also shows a parent their children's own conversations with
 * staff, read-only. They cannot write into them — that seat is `can_post =
 * false` — and everybody in the thread is told they are there.
 */
export default async function ParentChatPage() {
  const { claims, locationId } = await requireSchoolRole(['parent']);
  const me = await getSchoolUserByUid(locationId, claims.uid);

  if (me === null) {
    return (
      <div className="space-y-6">
        <PageHeader title="Messages" />
        <p className="text-sm text-ink-muted">No account at this school.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        description="Your children's teachers, and the school office."
      />

      <ChatWorkspace
        meId={me.id}
        canInitiate
        auditNotice="Conversations involving your child can be reviewed by school staff."
        emptyMessage="Nothing yet. Start a conversation with a teacher or the school office."
      />
    </div>
  );
}
