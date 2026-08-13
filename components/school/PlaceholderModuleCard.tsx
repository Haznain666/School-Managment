import { cn } from '@/lib/utils';

export interface PlaceholderModuleCardProps {
  /** Short emoji or glyph standing in for a real icon set. */
  icon: string;
  title: string;
  /** The module that will eventually provide this, e.g. "Academics". */
  moduleName: string;
  description?: string;
  className?: string;
}

/**
 * A card for functionality that is not built yet.
 *
 * Shared by all four portals so "coming later" looks the same everywhere, and
 * so it is visibly distinct from a real card that happens to have no data —
 * a teacher with an empty timetable should not see the same thing as a teacher
 * whose school has not bought the Academics module.
 */
export function PlaceholderModuleCard({
  icon,
  title,
  moduleName,
  description,
  className,
}: PlaceholderModuleCardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-dashed border-line-strong bg-surface-sunken p-5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-xl opacity-60">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="font-medium text-ink-muted">{title}</p>
          {description !== undefined ? (
            <p className="mt-1 text-sm text-ink-muted">{description}</p>
          ) : null}
          <p className="mt-2 text-xs uppercase tracking-wide text-ink-muted">
            Available in the {moduleName} module
          </p>
        </div>
      </div>
    </div>
  );
}
