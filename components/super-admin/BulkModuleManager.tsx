'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  SchoolMultiSelect,
  type SchoolOption,
} from '@/components/super-admin/SchoolMultiSelect';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import {
  MAX_SCHOOLS_PER_APPLY,
  modulesInPhase,
  PLATFORM_CHANNELS,
  PLATFORM_INTEGRATIONS,
  PLATFORM_MODULE_PHASES,
  type BulkFlagBaseline,
  type BulkFlagChoice,
  type SchoolFlagKey,
} from '@/lib/platform-modules';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

/**
 * Bulk module, channel and integration management across schools.
 *
 * ── The switch shows the truth, and the baseline keeps it safe ───────────
 * Every flag is a plain On/Off switch, and it opens showing what the selected
 * schools actually hold: on everywhere reads On, otherwise Off. That is the
 * whole point — a row saying "on everywhere" beside a switch that is not On
 * is a screen contradicting itself.
 *
 * The danger a two-state control classically has here is that it cannot say
 * "I did not touch this", so an apply built on checkboxes switches off every
 * module the operator never looked at. That is solved by the baseline rather
 * than by a third position: only flags whose switch differs from the loaded
 * baseline are sent, so an untouched flag is still never written. Nothing can
 * be decided before the baseline is known, which is why the switches are
 * inert until schools are selected and their state has loaded.
 *
 * ── Mixed selections ─────────────────────────────────────────────────────
 * Three schools, two with the module on, is not On and is not Off. The switch
 * is drawn with neither side lit, the badge says "on at 2 of 3", and either
 * side is then a real change because either one normalises the selection.
 */

interface SchoolFlagState {
  id: string;
  name: string;
  ghlConnected: boolean;
  flags: { key: string; enabled: boolean }[];
}

interface ApplyResult {
  applied: number;
  flagsPerSchool: number;
  writes: number;
  disconnectedGhl: number;
  schools: { id: string; name: string }[];
  missing: string[];
  warnings: { whatsappWithoutGhl: string[] };
}

export interface BulkModuleManagerProps {
  schools: readonly SchoolOption[];
}

const GHL = PLATFORM_INTEGRATIONS[0];

/** How a flag currently stands across the selected schools. */
function summarise(
  states: readonly SchoolFlagState[],
  key: string,
): { on: number; total: number } {
  const on = states.filter((state) =>
    state.flags.some((flag) => flag.key === key && flag.enabled),
  ).length;
  return { on, total: states.length };
}

function CurrentState({ on, total }: { on: number; total: number }) {
  if (total === 0) return null;

  const text =
    on === 0
      ? `off everywhere`
      : on === total
        ? `on everywhere`
        : `on at ${on} of ${total}`;

  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs',
        on === 0 || on === total
          ? 'bg-surface-sunken text-ink-muted'
          : 'bg-status-warning-subtle text-status-warning-onSubtle',
      )}
    >
      {text}
    </span>
  );
}

interface SwitchProps {
  /**
   * Where the switch sits: the operator's choice if they made one, otherwise
   * the baseline. `mixed` lights neither side; `undefined` is "no schools
   * selected yet", which is the only time the control is inert.
   */
  value: BulkFlagBaseline | undefined;
  /** True once the position differs from what the schools currently hold. */
  changed: boolean;
  disabled?: boolean;
  /** When set, "On" is unavailable and this says why. */
  onUnavailable?: string;
  onChange: (choice: BulkFlagChoice) => void;
}

function FlagSwitch({
  value,
  changed,
  disabled = false,
  onUnavailable,
  onChange,
}: SwitchProps) {
  const options: { choice: BulkFlagChoice; label: string }[] = [
    { choice: 'on', label: 'On' },
    { choice: 'off', label: 'Off' },
  ];

  return (
    <div
      className={cn(
        'inline-flex shrink-0 rounded-lg border p-0.5',
        // A moved switch is what the apply will write, so it is marked. Without
        // this, one changed row in a list of eleven is invisible.
        changed
          ? 'border-brand-primary ring-1 ring-brand-primary/30'
          : 'border-line-strong',
      )}
    >
      {options.map((option) => {
        const blocked = option.choice === 'on' && onUnavailable !== undefined;
        const active = value === option.choice;
        const unavailable = disabled || blocked || value === undefined;

        return (
          <button
            key={option.choice}
            type="button"
            disabled={unavailable}
            title={
              blocked
                ? onUnavailable
                : value === undefined
                  ? 'Select schools first.'
                  : undefined
            }
            aria-pressed={active}
            onClick={() => {
              onChange(option.choice);
            }}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium transition',
              active
                ? option.choice === 'on'
                  ? 'bg-status-success text-status-success-on'
                  : 'bg-status-danger text-status-danger-on'
                : 'text-ink-muted hover:bg-surface-hover',
              unavailable && 'cursor-not-allowed opacity-50 hover:bg-transparent',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function BulkModuleManager({ schools }: BulkModuleManagerProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, BulkFlagChoice>>({});
  const [states, setStates] = useState<SchoolFlagState[]>([]);
  const [isLoadingStates, setIsLoadingStates] = useState(false);

  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  // Read what the selection currently holds. Debounced, because ticking six
  // schools in a row should not be six round trips.
  useEffect(() => {
    if (selectedIds.length === 0) {
      setStates([]);
      return;
    }

    let cancelled = false;
    setIsLoadingStates(true);

    const timer = setTimeout(() => {
      void superAdminFetch<{ schools: SchoolFlagState[] }>(
        `/api/super-admin/schools/bulk-modules?school_ids=${selectedIds.join(',')}`,
      )
        .then((data) => {
          if (!cancelled) setStates(data.schools);
        })
        .catch(() => {
          // Non-fatal: the summary badges disappear, the apply still works.
          if (!cancelled) setStates([]);
        })
        .finally(() => {
          if (!cancelled) setIsLoadingStates(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedIds]);

  const setChoice = useCallback((key: string, choice: BulkFlagChoice) => {
    setResult(null);
    setError(null);
    setChoices((current) => ({ ...current, [key]: choice }));
  }, []);

  const ghlConnectedCount = states.filter((state) => state.ghlConnected).length;

  /**
   * The baseline is unknown until a selection has been read, and stale while a
   * new one is being read. Both cases must read as unknown rather than as the
   * previous selection's answer, or the switches would briefly show one set of
   * schools' state while another set is selected.
   */
  const baselineReady = states.length > 0 && !isLoadingStates;

  const baselineOf = useCallback(
    (key: string): BulkFlagBaseline | undefined => {
      if (!baselineReady) return undefined;
      const { on, total } = summarise(states, key);
      return on === total ? 'on' : on === 0 ? 'off' : 'mixed';
    },
    [baselineReady, states],
  );

  const ghlBaseline: BulkFlagBaseline | undefined = !baselineReady
    ? undefined
    : ghlConnectedCount === states.length
      ? 'on'
      : ghlConnectedCount === 0
        ? 'off'
        : 'mixed';

  /** Where a switch is drawn, and whether that is a change worth sending. */
  const positionOf = useCallback(
    (key: string, baseline: BulkFlagBaseline | undefined) => {
      if (baseline === undefined) return { value: undefined, changed: false };
      const choice = choices[key];
      if (choice === undefined) return { value: baseline, changed: false };
      return { value: choice, changed: choice !== baseline };
    },
    [choices],
  );

  // Only flags moved away from what the schools already hold. A switch left
  // where it was found is not sent, which is what keeps a bulk apply from
  // rewriting every module the operator never looked at.
  const flagUpdates = useMemo(
    () =>
      Object.entries(choices)
        .filter(
          ([key, choice]) =>
            key !== GHL.key &&
            baselineOf(key) !== undefined &&
            choice !== baselineOf(key),
        )
        .map(([key, choice]) => ({
          module_key: key as SchoolFlagKey,
          is_enabled: choice === 'on',
        })),
    [choices, baselineOf],
  );

  const disconnectGhl = choices[GHL.key] === 'off' && ghlBaseline !== undefined && ghlBaseline !== 'off';
  const changeCount = flagUpdates.length + (disconnectGhl ? 1 : 0);
  const canApply = selectedIds.length > 0 && changeCount > 0 && !isApplying;

  const handleApply = useCallback(async () => {
    if (!canApply) return;

    setIsApplying(true);
    setError(null);
    setResult(null);

    try {
      const data = await superAdminFetch<ApplyResult>(
        '/api/super-admin/schools/bulk-modules',
        {
          method: 'POST',
          body: JSON.stringify({
            school_ids: selectedIds,
            updates: flagUpdates,
            disconnect_ghl: disconnectGhl,
          }),
        },
      );

      setResult(data);
      // The choices are deliberately kept, not reset: the usual next action is
      // to apply the same set to a different group of schools.
      setStates([]);
      setSelectedIds([]);
    } catch (caught) {
      setError(
        caught instanceof SuperAdminApiError
          ? caught.message
          : 'Could not apply those changes.',
      );
    } finally {
      setIsApplying(false);
    }
  }, [canApply, selectedIds, flagUpdates, disconnectGhl]);

  const rowsFor = (
    entries: readonly { key: string; label: string; description?: string }[],
  ) =>
    entries.map((entry) => {
      const summary = summarise(states, entry.key);
      const position = positionOf(entry.key, baselineOf(entry.key));

      return (
        <div
          key={entry.key}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-0"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-ink">{entry.label}</p>
              {isLoadingStates ? null : <CurrentState {...summary} />}
            </div>
            {entry.description === undefined ? null : (
              <p className="mt-1 text-sm text-ink-muted">{entry.description}</p>
            )}
          </div>

          <FlagSwitch
            value={position.value}
            changed={position.changed}
            disabled={isApplying}
            onChange={(choice) => {
              setChoice(entry.key, choice);
            }}
          />
        </div>
      );
    });

  return (
    <div className="space-y-6">
      {/*
        `overflow-visible` overrides Card's own `overflow-hidden`, which exists
        to clip the header and footer to the rounded corners. Without this the
        multi-select's absolutely-positioned dropdown is clipped to the card:
        the filter box shows and the list of schools is cut off entirely, so
        the control looks broken and nothing can be selected. `cn` is
        tailwind-merge, so the later class wins.
      */}
      <Card
        className="overflow-visible"
        header={
          <CardTitle
            title="Schools"
            description="Everything below is applied to exactly these schools."
          />
        }
      >
        <SchoolMultiSelect
          schools={schools}
          selectedIds={selectedIds}
          disabled={isApplying}
          max={MAX_SCHOOLS_PER_APPLY}
          onChange={(ids) => {
            setSelectedIds(ids);
            setResult(null);
            setError(null);
          }}
        />
      </Card>

      <Card
        header={
          <CardTitle
            title="Modules"
            description="A disabled module is hidden from the portal navigation and refused at the API."
          />
        }
      >
        <div className="space-y-6">
          {PLATFORM_MODULE_PHASES.map((phase) => (
            <section key={phase}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Phase {phase}
              </h3>
              {rowsFor(modulesInPhase(phase))}
            </section>
          ))}
        </div>
      </Card>

      <Card
        header={
          <CardTitle
            title="Channels"
            description="How these schools’ messages reach people. Email always works and is never switched off."
          />
        }
      >
        {rowsFor(PLATFORM_CHANNELS)}

        {positionOf('whatsapp', baselineOf('whatsapp')).value === 'on' &&
        states.length > 0 ? (
          <p className="mt-3 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
            WhatsApp is delivered through each school’s own GoHighLevel
            sub-account.{' '}
            {ghlConnectedCount === states.length
              ? 'All of the selected schools have one connected.'
              : `${states.length - ghlConnectedCount} of the ${states.length} selected schools have not connected one, and will keep sending by email until they do.`}
          </p>
        ) : null}
      </Card>

      <Card
        header={
          <CardTitle
            title="Integrations"
            description="Third-party accounts. Not a simple switch — see below."
          />
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-ink">{GHL.label}</p>
              {states.length === 0 || isLoadingStates ? null : (
                <CurrentState on={ghlConnectedCount} total={states.length} />
              )}
            </div>
            <p className="mt-1 text-sm text-ink-muted">{GHL.description}</p>
            <p className="mt-2 text-sm text-ink-muted">
              <strong>Connecting cannot be done in bulk</strong> — each school
              needs its own {GHL.credentialLabel}, so there is nothing to
              broadcast. Connect one from the{' '}
              <span className="font-medium">Integrations</span> tab on that
              school. Disconnecting needs no per-school value, so it works here.
            </p>
          </div>

          <FlagSwitch
            {...positionOf(GHL.key, ghlBaseline)}
            disabled={isApplying}
            onUnavailable={`Each school needs its own ${GHL.credentialLabel}. Connect it on the school's Integrations tab.`}
            onChange={(choice) => {
              setChoice(GHL.key, choice);
            }}
          />
        </div>

        {disconnectGhl && ghlConnectedCount > 0 ? (
          <p className="mt-3 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
            This will clear the {GHL.credentialLabel} from {ghlConnectedCount}{' '}
            school{ghlConnectedCount === 1 ? '' : 's'}. The ids are not kept
            anywhere else — reconnecting means finding each one again in
            GoHighLevel.
          </p>
        ) : null}
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {result !== null ? (
        <div
          role="status"
          className="space-y-2 rounded-lg bg-status-success-subtle px-4 py-3 text-sm text-emerald-900"
        >
          <p className="font-medium">
            Applied {result.flagsPerSchool} change
            {result.flagsPerSchool === 1 ? '' : 's'} to {result.applied} school
            {result.applied === 1 ? '' : 's'}
            {result.disconnectedGhl > 0
              ? `, and disconnected GoHighLevel from ${result.disconnectedGhl}`
              : ''}
            .
          </p>

          <p className="text-status-success-onSubtle">
            {result.schools.map((school) => school.name).join(', ')}
          </p>

          {result.missing.length > 0 ? (
            <p className="text-status-warning-onSubtle">
              {result.missing.length} selected school
              {result.missing.length === 1 ? '' : 's'} no longer exist and
              {result.missing.length === 1 ? ' was' : ' were'} skipped.
            </p>
          ) : null}

          {result.warnings.whatsappWithoutGhl.length > 0 ? (
            <p className="text-status-warning-onSubtle">
              WhatsApp is on but not connected to GoHighLevel at:{' '}
              {result.warnings.whatsappWithoutGhl.join(', ')}. These will keep
              sending by email until each one is connected.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line bg-surface-sunken py-4">
        <Button isLoading={isApplying} disabled={!canApply} onClick={() => void handleApply()}>
          {selectedIds.length === 0
            ? 'Select schools first'
            : isLoadingStates
              ? 'Reading current settings…'
              : changeCount === 0
                ? 'Nothing switched yet'
                : `Apply ${changeCount} change${changeCount === 1 ? '' : 's'} to ${selectedIds.length} school${selectedIds.length === 1 ? '' : 's'}`}
        </Button>

        <Button
          variant="secondary"
          disabled={isApplying || changeCount === 0}
          onClick={() => {
            setChoices({});
            setResult(null);
            setError(null);
          }}
        >
          Undo my changes
        </Button>

        <Link
          href="/super-admin/schools"
          className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
        >
          Back to schools
        </Link>
      </div>
    </div>
  );
}
