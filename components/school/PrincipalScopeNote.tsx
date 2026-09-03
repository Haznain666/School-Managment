import { Card } from '@/components/ui/Card';

/**
 * The one line that tells a head what they are looking at — Sprint 23, item 3.
 *
 * ── Why every narrowed screen carries it ─────────────────────────────────
 * A narrowed list and a broken list look identical. A principal assigned three
 * classes opens the students screen, sees ninety children out of a school of
 * nine hundred, and has no way to tell whether that is their division or a
 * failure. The students page has carried this sentence since Sprint 13; item 3
 * narrows a dozen more screens, and each of them needs it for the same reason.
 *
 * ── `unassigned` is a real state and must not render as an empty page ────
 * A head at a `multiple` school with no assignment reaches nothing.
 * `describeScope()` writes the sentence that says who to ask, and that sentence
 * is the entire reason this component exists rather than the screens quietly
 * showing zero rows.
 *
 * ── It renders nothing when nothing is narrowed ──────────────────────────
 * `describeScope` answers null for every non-principal and for every school on
 * `principal_model = 'single'`, so dropping this onto a page is invisible until
 * a school opts in. That is what makes it safe to add everywhere.
 */
export function PrincipalScopeNote({ note }: { note: string | null }) {
  if (note === null) return null;

  return (
    <Card>
      <p className="text-sm text-ink-muted">{note}</p>
    </Card>
  );
}
