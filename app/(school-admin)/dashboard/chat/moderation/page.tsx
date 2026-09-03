import type { Metadata } from 'next';

import { ModerationQueue } from '@/components/chat/ModerationQueue';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Reported messages',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Reported and automatically flagged messages.
 *
 * Gated on `chat.moderate`, which by default reaches the school administrator,
 * the principal and a branch administrator and nobody else. This is a list of
 * things people said in confidence to a school, and reading it is what a
 * safeguarding complaint comes back to.
 *
 * A `safeguarding` row has already emailed the designated lead by the time it
 * appears here — `lib/chat-safeguarding.ts` does that at the moment the message
 * is written, because a queue read on Monday is the wrong place for a pupil
 * writing at two in the morning. This screen is where it is dealt with, not
 * where it is discovered.
 */
export default async function ChatModerationPage() {
  await requireSchoolPermission('chat.moderate');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reported messages"
        description="Most serious first. Closing one needs a sentence saying what the school did."
      />

      <ModerationQueue />
    </div>
  );
}
