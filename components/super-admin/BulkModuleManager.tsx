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
  type BulkFlagChoice,
  type SchoolFlagKey,
} from '@/lib/platform-modules';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

/**
 * Bulk module, channel and integration management across schools.
 *
 * ── The three-state control ──────────────────────────────────────────────
 * Every flag is On / Off / Leave unchanged, defaulting to unchanged, and only
 * the ones moved off that default are sent. A two-state control cannot say
 * "I did not touch this", so a bulk apply built on checkboxes switches off
 * every module the selected schools had on and the operator never looked at.
 * That is the single most important thing about this screen.
 *
 * ── Current state is shown, not assumed ──────────────────────────────────
 * Once schools are selected, each flag reports what the selection currently
 * holds — all on, all off, or mixed with a count. Applying "On" to a flag
 * already on everywhere is harmless but pointless; knowing which are mixed is
 * usually why someone opened this page.
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
          ? 'bg-slate-100 text-slate-600'
          : 'bg-amber-100 text-amber-800',
      )}
    >
      {text}
    </span>
  );
}

interface ChoiceProps {
  value: BulkFlagChoice;
  disabled?: boolean;
  /** When set, "On" is unavailable and this says why. */
  onUnavailable?: string;
  onChange: (choice: BulkFlagChoice) => void;
}

function ChoiceGroup({ value, disabled = false, onUnavailable, onChange }: ChoiceProps) {
  const options: { choice: BulkFlagChoice; label: string }[] = [
    { choice: 'unchanged', label: 'Leave' },
    { choice: 'on', label: 'On' },
    { choice: 'off', label: 'Off' },
  ];

  return (
    <div className="inline-flex shrink-0 rounded-lg border border-slate-300 p-0.5">
      {options.map((option) => {
        const blocked =
          option.choice === 'on' && onUnavailable !== undefined;
        const active = value === option.choice;

        return (
          <button
            key={option.choice}
            type="button"
            disabled={disabled || blocked}
            title={blocked ? onUnavailable : undefined}
            aria-pressed={active}
            onClick={() => {
              onChange(option.choice);
            }}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium transition',
              active
                ? option.choice === 'on'
                  ? 'bg-emerald-600 text-white'
                  : option.choice === 'off'
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-200 text-slate-700'
                : 'text-slate-600 hover:bg-slate-100',
              (disabled || blocked) && 'cursor-not-allowed opacity-50 hover:bg-transparent',
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

  const flagUpdates = useMemo(
    () =>
      Object.entries(choices)
        .filter(([key, choice]) => choice !== 'unchanged' && key !== GHL.key)
        .map(([key, choice]) => ({
          module_key: key as SchoolFlagKey,
          is_enabled: choice === 'on',
        })),
    [choices],
  );

  const disconnectGhl = choices[GHL.key] === 'off';
  const changeCount = flagUpdates.length + (disconnectGhl ? 1 : 0);
  const canApply = selectedIds.length > 0 && changeCount > 0 && !isApplying;

  const ghlConnectedCount = states.filter((state) => state.ghlConnected).length;

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

      return (
        <div
          key={entry.key}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-slate-900">{entry.label}</p>
              {isLoadingStates ? null : <CurrentState {...summary} />}
            </div>
            {entry.description === undefined ? null : (
              <p className="mt-1 text-sm text-slate-500">{entry.description}</p>
            )}
          </div>

          <ChoiceGroup
            value={choices[entry.key] ?? 'unchanged'}
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
      <Card
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
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
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

        {choices.whatsapp === 'on' && states.length > 0 ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
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
              <p className="text-sm font-medium text-slate-900">{GHL.label}</p>
              {states.length === 0 || isLoadingStates ? null : (
                <CurrentState on={ghlConnectedCount} total={states.length} />
              )}
            </div>
            <p className="mt-1 text-sm text-slate-500">{GHL.description}</p>
            <p className="mt-2 text-sm text-slate-600">
              <strong>Connecting cannot be done in bulk</strong> — each school
              needs its own {GHL.credentialLabel}, so there is nothing to
              broadcast. Connect one from the{' '}
              <span className="font-medium">Integrations</span> tab on that
              school. Disconnecting needs no per-school value, so it works here.
            </p>
          </div>

          <ChoiceGroup
            value={choices[GHL.key] ?? 'unchanged'}
            disabled={isApplying}
            onUnavailable={`Each school needs its own ${GHL.credentialLabel}. Connect it on the school's Integrations tab.`}
            onChange={(choice) => {
              setChoice(GHL.key, choice);
            }}
          />
        </div>

        {disconnectGhl && ghlConnectedCount > 0 ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            This will clear the {GHL.credentialLabel} from {ghlConnectedCount}{' '}
            school{ghlConnectedCount === 1 ? '' : 's'}. The ids are not kept
            anywhere else — reconnecting means finding each one again in
            GoHighLevel.
          </p>
        ) : null}
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {result !== null ? (
        <div
          role="status"
          className="space-y-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
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

          <p className="text-emerald-800">
            {result.schools.map((school) => school.name).join(', ')}
          </p>

          {result.missing.length > 0 ? (
            <p className="text-amber-800">
              {result.missing.length} selected school
              {result.missing.length === 1 ? '' : 's'} no longer exist and
              {result.missing.length === 1 ? ' was' : ' were'} skipped.
            </p>
          ) : null}

          {result.warnings.whatsappWithoutGhl.length > 0 ? (
            <p className="text-amber-800">
              WhatsApp is on but not connected to GoHighLevel at:{' '}
              {result.warnings.whatsappWithoutGhl.join(', ')}. These will keep
              sending by email until each one is connected.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 py-4">
        <Button isLoading={isApplying} disabled={!canApply} onClick={() => void handleApply()}>
          {selectedIds.length === 0
            ? 'Select schools first'
            : changeCount === 0
              ? 'No changes set'
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
          Reset choices
        </Button>

        <Link
          href="/super-admin/schools"
          className="text-sm font-medium text-slate-500 hover:text-slate-900 hover:underline"
        >
          Back to schools
        </Link>
      </div>
    </div>
  );
}
