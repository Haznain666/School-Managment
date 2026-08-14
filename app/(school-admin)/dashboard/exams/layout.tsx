import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { getModuleFlags } from '@/lib/school-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

/**
 * Module gate for every Exams screen.
 *
 * ── Why `academics` and not an `exams` module of its own ─────────────────
 * Exams are part of what a school teaches, and the two are useless apart: an
 * exam is scheduled against a section from Academics, its papers are the
 * subjects Academics owns, and its report card prints an attendance summary
 * that Academics collects. A separate flag would let an operator switch on the
 * half that cannot work alone. `PLATFORM_MODULES` is unchanged and no
 * migration widens the `school_modules` CHECK constraint.
 *
 * The check lives in a layout so that adding a page later cannot forget it —
 * the sidebar hides these links when the module is off, but a link is not a
 * permission and a typed URL would otherwise walk straight in.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ExamsLayout({ children }: { children: ReactNode }) {
  const { locationId } = await requireSchoolPermission('exams.read');
  const moduleFlags = await getModuleFlags(locationId);

  if (!moduleFlags.academics) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-ink">
          Academics is not enabled
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Exams and results are part of the Academics &amp; Timetable module,
          which this school does not currently have switched on. Contact the
          platform administrator to enable it.
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
