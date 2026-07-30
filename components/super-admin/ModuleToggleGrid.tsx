'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ModuleCard } from '@/components/super-admin/ModuleCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  emptyModuleFlags,
  modulesInPhase,
  PLATFORM_MODULE_PHASES,
  type PlatformModuleKey,
  type SchoolModuleFlags,
} from '@/lib/platform-modules';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

export interface ModuleToggleGridProps {
  schoolId: string;
}

/**
 * Module toggle grid, grouped by delivery phase.
 *
 * Changes are staged locally and written in one batch, so switching six
 * modules is one request and one audit entry rather than six of each. The
 * "saved" snapshot is what dirty state is measured against.
 */
export function ModuleToggleGrid({ schoolId }: ModuleToggleGridProps) {
  const [saved, setSaved] = useState<SchoolModuleFlags | null>(null);
  const [draft, setDraft] = useState<SchoolModuleFlags>(emptyModuleFlags);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void superAdminFetch<{ modules: SchoolModuleFlags }>(
      `/api/super-admin/schools/${schoolId}/modules`,
    )
      .then((data) => {
        if (cancelled) return;
        setSaved(data.modules);
        setDraft(data.modules);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load module settings.');
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const dirtyKeys = useMemo<PlatformModuleKey[]>(() => {
    if (saved === null) return [];
    return (Object.keys(draft) as PlatformModuleKey[]).filter(
      (key) => draft[key] !== saved[key],
    );
  }, [draft, saved]);

  const setModule = useCallback((key: PlatformModuleKey, enabled: boolean) => {
    setNotice(null);
    setDraft((current) => ({ ...current, [key]: enabled }));
  }, []);

  const setPhase = useCallback((phase: 1 | 2 | 3, enabled: boolean) => {
    setNotice(null);
    setDraft((current) => {
      const next = { ...current };
      // Named `entry` rather than `module` — the latter is a reserved binding
      // in a CommonJS scope and the Next.js lint rules reject it.
      for (const entry of modulesInPhase(phase)) {
        next[entry.key] = enabled;
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (dirtyKeys.length === 0) return;

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      const result = await superAdminFetch<{ modules: SchoolModuleFlags }>(
        `/api/super-admin/schools/${schoolId}/modules`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            modules: dirtyKeys.map((key) => ({
              module_key: key,
              is_enabled: draft[key],
            })),
          }),
        },
      );

      setSaved(result.modules);
      setDraft(result.modules);
      setNotice(
        `Saved ${dirtyKeys.length} module${dirtyKeys.length === 1 ? '' : 's'}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof SuperAdminApiError
          ? caught.message
          : 'Could not save module settings.',
      );
    } finally {
      setIsSaving(false);
    }
  }, [dirtyKeys, draft, schoolId]);

  const handleReset = useCallback(() => {
    if (saved !== null) setDraft(saved);
    setNotice(null);
    setError(null);
  }, [saved]);

  if (saved === null) {
    return (
      <Card>
        <p className="text-sm text-slate-500">
          {error ?? 'Loading module settings…'}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {PLATFORM_MODULE_PHASES.map((phase) => {
        const modules = modulesInPhase(phase);
        const allOn = modules.every((module) => draft[module.key]);

        return (
          <section key={phase} className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Phase {phase}
              </h3>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isSaving || allOn}
                  onClick={() => {
                    setPhase(phase, true);
                  }}
                >
                  Enable all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isSaving || modules.every((m) => !draft[m.key])}
                  onClick={() => {
                    setPhase(phase, false);
                  }}
                >
                  Disable all
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {modules.map((module) => (
                <ModuleCard
                  key={module.key}
                  module={module}
                  enabled={draft[module.key]}
                  dirty={draft[module.key] !== saved[module.key]}
                  disabled={isSaving}
                  onChange={(enabled) => {
                    setModule(module.key, enabled);
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-slate-200 bg-slate-50 py-4">
        <Button
          isLoading={isSaving}
          disabled={dirtyKeys.length === 0}
          onClick={() => {
            void handleSave();
          }}
        >
          {dirtyKeys.length === 0
            ? 'No changes'
            : `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}`}
        </Button>

        <Button
          variant="secondary"
          disabled={isSaving || dirtyKeys.length === 0}
          onClick={handleReset}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
