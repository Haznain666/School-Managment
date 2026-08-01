import { Badge } from '@/components/ui/Badge';
import { LogoutButton } from '@/components/school/LogoutButton';
import { ROLE_LABELS, type UserRole } from '@/types/school-auth';

export interface SchoolNavbarProps {
  schoolName: string;
  logoUrl: string | null;
  /** Portal label shown beside the school name, e.g. "Teacher Portal". */
  portalLabel?: string;
  userName: string;
  role: UserRole;
  schoolSlug: string | null;
  /**
   * Set when the platform operator is inside a customer's portal. They hold
   * ordinary school_admin rights; this only makes that visible, so nobody —
   * including the operator — mistakes the session for a member of the school.
   */
  platformAdminEmail?: string | null;
}

/** Top bar shared by every school portal. */
export function SchoolNavbar({
  schoolName,
  logoUrl,
  portalLabel,
  userName,
  role,
  schoolSlug,
  platformAdminEmail = null,
}: SchoolNavbarProps) {
  const isPlatformSession = platformAdminEmail !== null && platformAdminEmail !== '';

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {logoUrl !== null && logoUrl !== '' ? (
          // School logos arrive at unpredictable dimensions; a plain <img>
          // avoids forcing a size onto them.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="h-9 w-9 rounded-md object-contain"
            loading="lazy"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-primary text-sm font-semibold text-white"
          >
            {schoolName.slice(0, 2).toUpperCase()}
          </span>
        )}

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{schoolName}</p>
          {portalLabel !== undefined ? (
            <p className="text-xs text-slate-500">{portalLabel}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isPlatformSession ? (
          <Badge variant="warning">Platform Super Admin</Badge>
        ) : null}
        <Badge variant="neutral">{ROLE_LABELS[role]}</Badge>
        <span className="hidden truncate text-sm text-slate-600 sm:inline">
          {isPlatformSession ? platformAdminEmail : userName}
        </span>
        <LogoutButton schoolSlug={schoolSlug} />
      </div>
    </header>
  );
}
