'use client';

import { useCallback, useState } from 'react';

import {
  PeriodStructureManager,
  type PeriodStructureGradeOption,
} from '@/components/academics/PeriodStructureManager';
import {
  TimetableBuilder,
  type TimetableBuilderProps,
} from '@/components/academics/TimetableBuilder';

/**
 * The timetable screen: the grid, and the schedules its rows come from.
 *
 * ── Why these are wrapped rather than stacked ────────────────────────────
 * Editing a period schedule changes the rows of the grid above it. As two
 * independent components they each held their own copy of the truth, so
 * retiring a period left it drawn in the grid, and adding one left a row
 * missing — until somebody reloaded the page and could not tell whether their
 * edit had saved.
 *
 * A shared counter is all the coupling that needs: the manager bumps it after
 * every write, the builder takes it as a key to refetch on. Lifting the whole
 * payload into here instead would make the builder unable to refetch itself
 * after saving a lesson, which is the far more common action.
 */
export interface TimetableWorkspaceProps
  extends Omit<TimetableBuilderProps, 'reloadKey'> {
  canEdit: boolean;
  grades: readonly PeriodStructureGradeOption[];
}

export function TimetableWorkspace({
  canEdit,
  grades,
  ...builderProps
}: TimetableWorkspaceProps) {
  const [reloadKey, setReloadKey] = useState(0);

  const onChanged = useCallback(() => {
    setReloadKey((previous) => previous + 1);
  }, []);

  return (
    <div className="space-y-4">
      <TimetableBuilder
        {...builderProps}
        grades={grades.map((grade) => ({ id: grade.id, label: grade.label }))}
        reloadKey={reloadKey}
      />

      <PeriodStructureManager canEdit={canEdit} grades={grades} onChanged={onChanged} />
    </div>
  );
}
