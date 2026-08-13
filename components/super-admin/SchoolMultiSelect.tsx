'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

export interface SchoolOption {
  id: string;
  name: string;
  city: string;
  slug: string;
  isActive: boolean;
}

export interface SchoolMultiSelectProps {
  schools: readonly SchoolOption[];
  selectedIds: readonly string[];
  disabled?: boolean;
  max?: number;
  onChange: (ids: string[]) => void;
}

/**
 * Multi-select over the school directory.
 *
 * ── Why not a native <select multiple> ───────────────────────────────────
 * The obvious control, and the wrong one. Native multi-select requires
 * ctrl-clicking to add a second item and silently drops the whole selection
 * on a plain click — with a destructive apply behind it, "I lost 19 of my 20
 * schools and did not notice" is a real outcome. This is a dropdown of
 * checkboxes instead: clicking toggles one school and nothing else.
 *
 * ── The chips are the point ──────────────────────────────────────────────
 * The selection is shown as named chips outside the dropdown, always visible,
 * each removable. The operator is about to change settings for schools they
 * cannot see on screen, so the list of exactly who that is has to be readable
 * without reopening anything.
 */
export function SchoolMultiSelect({
  schools,
  selectedIds,
  disabled = false,
  max,
  onChange,
}: SchoolMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const container = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Order follows the directory, not the click order, so the chip list reads
  // the same as the dropdown above it.
  const selectedSchools = useMemo(
    () => schools.filter((school) => selected.has(school.id)),
    [schools, selected],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return schools;
    return schools.filter((school) =>
      `${school.name} ${school.city} ${school.slug}`.toLowerCase().includes(needle),
    );
  }, [schools, query]);

  const atMax = max !== undefined && selectedIds.length >= max;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent): void => {
      if (container.current?.contains(event.target as Node) === false) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = (id: string): void => {
    if (selected.has(id)) {
      onChange(selectedIds.filter((selectedId) => selectedId !== id));
      return;
    }
    if (atMax) return;
    onChange([...selectedIds, id]);
  };

  return (
    <div className="space-y-3">
      <div ref={container} className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => {
            setOpen((current) => !current);
          }}
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-lg border border-line-strong bg-surface-raised px-3 py-2 text-left text-sm transition',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
            disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-surface-hover',
          )}
        >
          <span className={selectedIds.length === 0 ? 'text-ink-muted' : 'text-ink'}>
            {selectedIds.length === 0
              ? 'Choose schools…'
              : `${selectedIds.length} school${selectedIds.length === 1 ? '' : 's'} selected`}
          </span>
          <span aria-hidden="true" className="text-ink-muted">
            {open ? '▲' : '▼'}
          </span>
        </button>

        {open ? (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-surface-raised shadow-lg">
            <div className="border-b border-line p-2">
              <Input
                label="Filter schools"
                hideLabel
                autoFocus
                value={query}
                placeholder="Filter by name, city or subdomain"
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </div>

            <ul role="listbox" aria-multiselectable="true" className="max-h-72 overflow-y-auto p-1">
              {matches.length === 0 ? (
                <li className="px-3 py-4 text-sm text-ink-muted">
                  No school matches “{query}”.
                </li>
              ) : (
                matches.map((school) => {
                  const isSelected = selected.has(school.id);

                  return (
                    <li key={school.id}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-md px-3 py-2 text-sm',
                          !isSelected && atMax
                            ? 'cursor-not-allowed opacity-50'
                            : 'hover:bg-surface-hover',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          checked={isSelected}
                          disabled={!isSelected && atMax}
                          onChange={() => {
                            toggle(school.id);
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-ink">
                            {school.name}
                            {school.isActive ? null : (
                              <span className="ml-2 text-xs font-normal text-status-warning-ink">
                                inactive
                              </span>
                            )}
                          </span>
                          <span className="block font-mono text-xs text-ink-muted">
                            {school.city} · {school.slug}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>

            <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-2">
              <Button
                size="sm"
                variant="ghost"
                // Selects what is currently *filtered*, not the whole
                // directory — "select all" while a filter is showing four
                // schools must not quietly pick up the other sixty.
                disabled={matches.length === 0 || atMax}
                onClick={() => {
                  const room =
                    max === undefined ? Infinity : max - selectedIds.length;

                  onChange([
                    ...selectedIds,
                    ...matches
                      .filter((school) => !selected.has(school.id))
                      .slice(0, room)
                      .map((school) => school.id),
                  ]);
                }}
              >
                Select these {matches.length}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                disabled={selectedIds.length === 0}
                onClick={() => {
                  onChange([]);
                }}
              >
                Clear all
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {selectedSchools.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No schools selected. Nothing can be applied until at least one is.
        </p>
      ) : (
        <div>
          <div className="flex flex-wrap gap-2" aria-live="polite">
            {selectedSchools.map((school) => (
              <span
                key={school.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary/10 py-1 pl-3 pr-1.5 text-sm text-brand-primary"
              >
                <span className="font-medium">{school.name}</span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${school.name} from the selection`}
                  onClick={() => {
                    toggle(school.id);
                  }}
                  className="rounded-full px-1.5 leading-none text-brand-primary/70 transition hover:bg-brand-primary/20 hover:text-brand-primary disabled:cursor-not-allowed"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          {atMax ? (
            <p className="mt-2 text-sm text-status-warning-ink">
              {max} schools is the most one apply may touch. Remove one to add
              another.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
