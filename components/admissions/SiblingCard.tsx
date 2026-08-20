import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import type { SiblingRow } from '@/lib/siblings';

/**
 * Who else in this family is at this school.
 *
 * ── Why a card and not a line on the guardian panel ──────────────────────
 * "Which of my students are related" was answerable on exactly one screen in
 * this product — the family voucher — and only for children with an open
 * challan in the month being billed. Everywhere else, a school looking at
 * Ahmed had no way to know that Fatima two classes up is his sister, which is
 * the fact behind the sibling discount, the shared transport, the parent who
 * turns up once for two parents' evenings and the phone call that should reach
 * one number rather than two.
 *
 * ── The admission number is shown, and shown in the same font ────────────
 * `GVS-2025-0007` is what an admin types into every other search box in the
 * product. Naming the sibling without it means reading the name, going to the
 * student list, searching it and hoping there is only one Fatima Khan.
 *
 * ── Withdrawn siblings still appear ──────────────────────────────────────
 * With no class beside their name and a badge saying so. An elder brother who
 * left last year is the reason a school's records mention this family twice,
 * and hiding him makes the remaining half look like an error.
 *
 * ── Which guardian they are shared through ───────────────────────────────
 * Printed under each name. The sibling rule matches on a guardian's CNIC or
 * their phone number, and the phone half can group two families who share a
 * handset — see `lib/siblings.ts`. Naming the guardian is what lets an admin
 * see a wrong grouping rather than trust it.
 */
export function SiblingCard({
  siblings,
  /** Where each name links. The admin and parent portals differ. */
  hrefFor,
  /**
   * Overridden on the application screen, where the person this list belongs
   * to is not a student yet and so has no siblings — they have a family.
   */
  title = 'Siblings at this school',
  description = "Students who share a guardian with this one. Matched on the guardian's CNIC, or on their phone number where no CNIC is recorded.",
}: {
  siblings: readonly SiblingRow[];
  hrefFor?: (sibling: SiblingRow) => string;
  title?: string;
  description?: string;
}) {
  if (siblings.length === 0) return null;

  return (
    <Card header={<CardTitle title={title} description={description} />}>
      <ul className="divide-y divide-line">
        {siblings.map((sibling) => {
          const name = (
            <span className="font-medium text-ink">{sibling.name}</span>
          );

          return (
            <li
              key={sibling.studentProfileId}
              className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p>
                  {hrefFor === undefined ? (
                    name
                  ) : (
                    <Link
                      href={hrefFor(sibling)}
                      className="font-medium text-brand-primary hover:underline"
                    >
                      {sibling.name}
                    </Link>
                  )}{' '}
                  <span className="font-mono text-xs text-ink-muted">
                    {sibling.studentId}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  via {sibling.sharedGuardianName}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {sibling.gradeName === null ? null : (
                  <span className="text-sm text-ink-muted">
                    {sibling.gradeName}
                    {sibling.sectionName === null ? '' : ` — ${sibling.sectionName}`}
                  </span>
                )}
                {sibling.isCurrentlyEnrolled ? null : (
                  <Badge variant="neutral">Not currently enrolled</Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
