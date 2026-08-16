import Link from 'next/link';

/**
 * The multi-child selector, defined once.
 *
 * It had been written out inline on the dashboard and again on the attendance
 * page, which is two copies of the rule "the selected child is a pill and the
 * others are links". Sprint 13 adds four more parent screens that need it, and
 * six copies of a highlight rule is how one of them ends up highlighting
 * nothing.
 *
 * ── One child renders nothing ────────────────────────────────────────────
 * A selector offering a single choice is a control that cannot be used, and
 * most families have one child at a school. Callers do not have to check —
 * they pass the list and this decides.
 *
 * ── The child travels in the URL, and that is safe ───────────────────────
 * `?child=` selects among children this parent's own query returned; an id
 * from another family matches nothing and falls back to their first child. The
 * link is therefore shareable and bookmarkable without being a way to reach
 * somebody else's record. Every parent page repeats that check — it is not
 * delegated here, because a component that renders links is the wrong place to
 * hold an authorisation rule.
 */
export function ChildSelector({
  students,
  selectedId,
  basePath,
  /** Query parameters to carry across, so a month or term survives the switch. */
  extraParams,
}: {
  /**
   * Deliberately not called `children`. That name is React's, and passing a
   * data array under it is both a lint error and a component whose signature
   * lies about what nesting tags inside it would do.
   */
  students: readonly { studentProfileId: string; name: string }[];
  selectedId: string | null;
  basePath: string;
  extraParams?: Readonly<Record<string, string>>;
}) {
  if (students.length < 2) return null;

  const hrefFor = (studentProfileId: string): string => {
    const params = new URLSearchParams({ ...extraParams, child: studentProfileId });
    return `${basePath}?${params.toString()}`;
  };

  return (
    <nav aria-label="Children" className="flex flex-wrap gap-2">
      {students.map((child) => {
        const current = child.studentProfileId === selectedId;
        return (
          <Link
            key={child.studentProfileId}
            href={hrefFor(child.studentProfileId)}
            aria-current={current ? 'page' : undefined}
            className={
              current
                ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-onPrimary'
                : 'rounded-full bg-surface-sunken px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-line'
            }
          >
            {child.name}
          </Link>
        );
      })}
    </nav>
  );
}
