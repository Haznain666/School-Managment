'use client';

import { Badge } from '@/components/ui/Badge';
import { Toggle } from '@/components/ui/Toggle';
import { cn } from '@/lib/utils';
import type { PlatformModule } from '@/lib/platform-modules';

export interface ModuleCardProps {
  module: PlatformModule;
  enabled: boolean;
  /** True when this card differs from what is saved. */
  dirty: boolean;
  disabled?: boolean;
  /**
   * Phase 1 — included with every school (Sprint 35, E9). Drawn as a badge
   * where the switch would be: a switch that is always on and refuses to move
   * invites exactly the click it then has to refuse.
   */
  included?: boolean;
  onChange: (enabled: boolean) => void;
}

export function ModuleCard({
  module,
  enabled,
  dirty,
  disabled = false,
  included = false,
  onChange,
}: ModuleCardProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 rounded-card border bg-surface-raised p-4 transition',
        dirty ? 'border-brand-primary shadow-card' : 'border-line',
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{module.label}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <Badge variant="neutral">Phase {module.phase}</Badge>
          {dirty ? <Badge variant="warning">Unsaved</Badge> : null}
        </div>
      </div>

      {included ? (
        <Badge variant="success">Included</Badge>
      ) : (
        <Toggle
          label={module.label}
          hideLabel
          checked={enabled}
          disabled={disabled}
          onChange={onChange}
        />
      )}
    </div>
  );
}
