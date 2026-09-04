import { PageHeader } from '@/components/ui/PageHeader';

/**
 * What a portal shows when the school has Chat switched off.
 *
 * ── Why the three portals share one of these ─────────────────────────────
 * Sprint 26 made the `chat` module flag mean the same thing on all four
 * portals. The administrative one refuses in a `layout.tsx` because it has a
 * folder of screens to cover; the teacher, parent and pupil portals have one
 * page each, so they check inline and render this.
 *
 * It says the school has not switched it on, and it does **not** say who to
 * ask. A parent has no platform administrator to contact, and telling them to
 * find one is worse than telling them nothing — the sentence they can act on is
 * "ask the school", which is what they are already able to do.
 */
export function ChatDisabledNotice() {
  return (
    <div className="space-y-6">
      <PageHeader title="Messages" />
      <p className="text-sm text-ink-muted">
        This school has not switched messaging on. Nothing has gone wrong, and
        there is nothing to read here yet.
      </p>
    </div>
  );
}
