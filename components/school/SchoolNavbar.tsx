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

/**
 * Top bar shared by every school portal.
 *
 * Painted in the palette's `primary`, as `PalettePreview` has always drawn it.
 * The lettering is `onPrimary` — computed from that colour rather than assumed
 * white — and the two badges are drawn as tints of the foreground so they read
 * on a light primary as well as a dark one, which the fixed amber and slate
 * chips of the shared `Badge` would not.
 */
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
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 bg-brand-primary px-4 text-brand-onPrimary sm:px-6">
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
            className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-onPrimary/15 text-sm font-semibold text-brand-onPrimary"
          >
            {schoolName.slice(0, 2).toUpperCase()}
          </span>
        )}

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{schoolName}</p>
          {portalLabel !== undefined ? (
            <p className="text-xs opacity-75">{portalLabel}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isPlatformSession ? (
          <span className="rounded-full bg-brand-onPrimary/20 px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-current">
            Platform Super Admin
          </span>
        ) : null}
        <span className="rounded-full bg-brand-onPrimary/10 px-2 py-0.5 text-xs font-medium">
          {ROLE_LABELS[role]}
        </span>
        <span className="hidden truncate text-sm opacity-90 sm:inline">
          {isPlatformSession ? platformAdminEmail : userName}
        </span>
        <LogoutButton schoolSlug={schoolSlug} />
      </div>
    </header>
  );
}
