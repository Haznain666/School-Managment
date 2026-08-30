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
 *
 * ── And which campus, when it is not this one — Sprint 20, item 8 ────────
 * The sibling rule is school-wide and always was: it matches on
 * `student_guardians.location_id` and joins no `branches`, so two children at
 * two campuses of one school have always read as siblings. What was missing is
 * that a clerk at Defence, looking at a discount granted because of a child at
 * Karachi, saw a name with no class beside it and no reason for the grant.
 * `contextBranchId` is the campus the reader is looking *from*; anything else
 * is badged. Pass it and a one-campus school sees nothing new.
 */
export function SiblingCard({
  siblings,
  /** Where each name links. The admin and parent portals differ. */
  hrefFor,
  /**
   * The campus of the student this list is about, when there is one.
   *
   * A sibling at a different campus is badged with theirs. Omitted, every
   * sibling's campus is shown — which is right on a screen that is not about
   * one child, and wrong nowhere.
   */
  contextBranchId,
  /**
   * Overridden on the application screen, where the person this list belongs
   * to is not a student yet and so has no siblings — they have a family.
   */
  title = 'Siblings at this school',
  description = "Students who share a guardian with this one. Matched on the guardian's CNIC, or on their phone number where no CNIC is recorded.",
}: {
  siblings: readonly SiblingRow[];
  hrefFor?: (sibling: SiblingRow) => string;
  contextBranchId?: string | null;
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
                {/*
                  The campus, when it is not the one this list is being read
                  from. Item 8: a discount granted for a child at another campus
                  has to say which one, or it reads as a grant with no reason.
                */}
                {sibling.branchName !== null &&
                (contextBranchId === undefined ||
                  contextBranchId !== sibling.branchId) ? (
                  <Badge variant="neutral">{sibling.branchName}</Badge>
                ) : null}
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
