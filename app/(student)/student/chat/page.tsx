import type { Metadata } from 'next';

import { ChatDisabledNotice } from '@/components/chat/ChatDisabledNotice';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolRole } from '@/lib/school-guard';
import { getModuleFlags, getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Messages',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A pupil's messages.
 *
 * `canInitiate` is passed true and that is not the same as being able to: the
 * composer asks `/chat/reachable`, which answers with nothing unless a live
 * grant covers this pupil *and* the teacher has opted in. Hiding the button
 * outright would mean a pupil whose teacher opened the class for two hours
 * would have to reload the page to discover it, and the empty list already
 * explains itself in a sentence.
 *
 * The notice is disclosed rather than implied. `ROADMAP.md` agreed on
 * 2026-08-07 that staff may review conversations involving a pupil, and its
 * wording is the part that is easy to drop: make it visible rather than covert.
 * A pupil who does not know who can read this cannot make an informed decision
 * about what to write, and a covert audit is surveillance rather than
 * safeguarding.
 */
export default async function StudentChatPage() {
  const { claims, locationId } = await requireSchoolRole(['student']);
  // Sprint 26: the module flag is honoured on every portal, not only the
  // administrative one. A link is not a permission, so the page refuses too.
  if (!(await getModuleFlags(locationId)).chat) return <ChatDisabledNotice />;
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
        description="Questions to your teachers, and their replies."
      />

      <ChatWorkspace
        meId={me.id}
        canInitiate
        auditNotice="Your parents and your class teacher can read this conversation, and school staff may review it."
        emptyMessage="Nothing yet. When a teacher writes to you it will appear here, and you can reply."
      />
    </div>
  );
}
