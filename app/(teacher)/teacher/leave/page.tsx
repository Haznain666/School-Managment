import type { Metadata } from 'next';

import { LeaveSelfService } from '@/components/leave/LeaveSelfService';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolRole } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'My leave',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A teacher's own leave — applying for it, and what the school decided.
 *
 * ── The reason this page was read-only has been answered ─────────────────
 * Until Sprint 33b it listed leave and told the reader to go to the office,
 * and its docblock said why: a self-service application needed rules that did
 * not exist — *who approves a head's leave, what happens to an application for
 * a day already marked on the register, whether a teacher may withdraw one
 * after it is approved*.
 *
 * All three now have answers. `lib/approval-chain.ts` says who decides, the
 * campus's holiday rule and the person's own staff calendar say which days
 * count, and a request may be withdrawn while it is pending and not after. So
 * the form is here and the old reasoning is gone rather than left on the page
 * arguing with the button underneath it.
 *
 * The screen itself is `components/leave/LeaveSelfService.tsx`, which the
 * administrative dashboard renders too: applying for leave is the same act
 * whichever portal you work in, and two copies of it would be two forms to
 * keep in step with one set of rules.
 */
export default async function TeacherLeavePage() {
  await requireSchoolRole(['teacher']);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My leave"
        description="Apply for leave, see what you have left, and read what your school decided."
      />

      <LeaveSelfService />
    </div>
  );
}
