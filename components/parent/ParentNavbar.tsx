import { ChildSwitcher } from '@/components/parent/ChildSwitcher';
import { SchoolNavbar } from '@/components/school/SchoolNavbar';
import type { UserRole } from '@/types/school-auth';

export interface ParentNavbarProps {
  schoolName: string;
  logoUrl: string | null;
  userName: string;
  role: UserRole;
  schoolSlug: string | null;
  /** Every child this login is recorded against. Empty for a new account. */
  students: readonly { studentProfileId: string; studentId: string; name: string }[];
  searchResultsHref?: string;
  unreadNotifications?: number;
  /** The reader's campus, at a school with more than one. See `lib/branch-header.ts`. */
  branchName?: string | null;
}

/**
 * Parent portal top bar — the shared navbar, a fixed label, and the child
 * switcher.
 *
 * ── Why the switcher is not wrapped in `Suspense` ────────────────────────
 * It reads `useSearchParams`, and it used to sit in a `<Suspense fallback={null}>`
 * whose comment said the boundary was "never actually hit in production". It
 * was hit on every load: the live HTML carried the switcher as a separately
 * streamed segment (`<div hidden id="S:0">`, swapped in by `$RC`), so the header
 * arrived in two pieces, one more streamed boundary on a page that already had
 * two. On 2026-09-13 `/parent/results` logged React #418 followed by `$RS`
 * failing on `parentNode` — a hydration fallback discarding a streamed segment
 * before its swap script ran — and that stack of boundaries is the only part of
 * the failure this code controls. See STATE.md §5by.
 *
 * Without the boundary the switcher renders in the shell with the rest of the
 * bar. That is safe because the parent layout is `force-dynamic`: a dynamic
 * render can read search params on the server, so there is no bailout to
 * catch. If the layout ever becomes static, `next build` fails naming
 * `useSearchParams` — a build error that points at this file, which is the
 * right way for that change to announce itself.
 */
export function ParentNavbar({ students, ...props }: ParentNavbarProps) {
  return (
    <SchoolNavbar
      {...props}
      portalLabel="Parent Portal"
      contextSlot={<ChildSwitcher students={students} />}
    />
  );
}
