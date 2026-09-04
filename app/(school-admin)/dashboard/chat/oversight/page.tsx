import type { Metadata } from 'next';

import { OversightBrowser } from '@/components/chat/OversightBrowser';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'All conversations',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Every conversation the caller is accountable for.
 *
 * ── What this is, next to Reported messages ──────────────────────────────
 * The moderation queue is a list of things somebody complained about. This is
 * the correspondence itself — staff to staff, teacher to teacher, and every
 * thread involving a parent or a pupil — and the product owner asked for it in
 * exactly those terms: a School Administrator reads the whole school, a
 * Principal reads the campuses they run, and a Principal given particular
 * grades reads those grades' pupil threads plus all of their campuses'
 * staff-to-staff.
 *
 * A Branch Administrator is not here. `chat.oversight` is absent from their
 * default set, so this page refuses them and the sidebar never offers it.
 *
 * ── The scope is not the screen's to decide ──────────────────────────────
 * `requireSchoolPermission` is the door; `resolveOversightScope` inside the API
 * decides the reach, from the session's own role and uid. This page passes
 * nothing about who the caller is, so there is no parameter to tamper with.
 *
 * ── Disclosure ───────────────────────────────────────────────────────────
 * Everybody whose messages can appear here is told so in their own thread —
 * `OVERSIGHT_NOTICE`, rendered by `ChatWorkspace` above the transcript. That
 * sentence is not decoration and is the half that makes this a school reading
 * its own correspondence rather than a school watching its staff.
 */
export default async function ChatOversightPage() {
  await requireSchoolPermission('chat.oversight');

  return (
    <div className="space-y-6">
      <PageHeader
        title="All conversations"
        description="Everything written in the campuses and classes you cover. Read-only — you cannot reply from here, and everyone in a conversation is told it can be read."
      />

      <OversightBrowser />
    </div>
  );
}
