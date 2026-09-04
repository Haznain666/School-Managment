import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { getModuleFlags } from '@/lib/school-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

/**
 * Module gate for every Messages screen in the administrative portal.
 *
 * ── Sprint 26: the flag gated a link and nothing else ────────────────────
 * `school-nav.ts` has hidden the entry on `moduleFlags.chat` since Sprint 24,
 * and until this file existed that was the *entire* enforcement of the module:
 * the page behind it checked `chat.read` and no route under
 * `/api/school/chat/**` checked anything. A flag that hides one link while
 * every door stays open is not a gate, and CLAUDE.md's own rule — a link is not
 * a permission — is the sentence it was failing.
 *
 * It is also how the module went unnoticed. **No school on the platform had a
 * `chat` row at all**, so the flag read false everywhere and the Messages entry
 * was invisible to every administrator, principal and branch admin, while
 * teachers, parents and pupils — whose sidebars never consulted it — had a
 * working inbox at the same school. That is the bug this sprint was opened for,
 * and the fix is in two halves: the flag is now honoured on all four portals,
 * and it is switched *on* for the schools that already have people chatting.
 *
 * Told plainly rather than 404'd, exactly as the other module layouts do it: a
 * school that has not enabled Chat has made no mistake.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AdminChatLayout({ children }: { children: ReactNode }) {
  const { locationId } = await requireSchoolPermission('chat.read');
  const moduleFlags = await getModuleFlags(locationId);

  if (!moduleFlags.chat) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">Messaging is not enabled</h2>
        <p className="mt-2 text-sm text-ink-muted">
          This school does not currently have the Chat &amp; Messaging module
          switched on. Contact the platform administrator to enable it.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
        >
          Back to dashboard
        </Link>
      </Card>
    );
  }

  return <>{children}</>;
}
