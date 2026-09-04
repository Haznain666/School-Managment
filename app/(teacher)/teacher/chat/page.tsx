import type { Metadata } from 'next';

import { BroadcastComposer } from '@/components/chat/BroadcastComposer';
import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { ClassChatAccess } from '@/components/chat/ClassChatAccess';
import { PageHeader } from '@/components/ui/PageHeader';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { listTeacherSections } from '@/lib/academics-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Messages',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A teacher's messages, and the control that opens a class.
 *
 * The class list comes from `listTeacherSections`, which
 * `lib/academics-queries.ts` calls the teacher portal's authorisation list
 * rather than a convenience — and it is used here for exactly that. It is what
 * the "open chat" control offers, and the server re-derives it in
 * `grantScopeProblem` before writing a grant, because a section id in a request
 * body is untrusted however the screen obtained it.
 */
export default async function TeacherChatPage() {
  const { claims, locationId } = await requireSchoolRole(['teacher']);
  const me = await getSchoolUserByUid(locationId, claims.uid);

  if (me === null) {
    return (
      <div className="space-y-6">
        <PageHeader title="Messages" />
        <p className="text-sm text-ink-muted">No account at this school.</p>
      </div>
    );
  }

  const year = await getActiveAcademicYear(locationId);
  const sections = year === null ? [] : await listTeacherSections(locationId, me.id, year.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        description="Parents, colleagues, and your own classes."
      />

      <BroadcastComposer
        sections={sections.map((section) => ({
          sectionId: section.sectionId,
          label: section.label,
        }))}
      />

      <ClassChatAccess sections={sections} />

      <ChatWorkspace
        meId={me.id}
        canAttach
        canInitiate
        auditNotice="Conversations involving a student can be reviewed by school administrators."
        emptyMessage="Nothing yet. Start a conversation with a parent or a colleague."
      />
    </div>
  );
}
