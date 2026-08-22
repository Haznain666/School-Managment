'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { SubcategoryBadge } from '@/components/exams/SubcategoryBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import type { ExamSettings, ResultSubcategoryRow } from '@/lib/exam-queries';
import {
  normalizeHex,
  subcategoryProblem,
  SUBCATEGORY_LABEL_MAX,
} from '@/lib/result-subcategories';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The exam settings screen: the school's descriptors, and the two switches.
 *
 * ── The preview is the point of the colour picker ────────────────────────
 * `subcategoryStyle` computes the foreground from the background, so a school
 * that picks a pale amber gets dark lettering and one that picks a deep blue
 * gets light. Nobody can predict that from a colour swatch, and a school only
 * finds out what it chose when a report card comes off the printer. So the chip
 * beside the picker is the same component the card renders — same function,
 * same answer.
 *
 * ── Delete refuses, archive does not ─────────────────────────────────────
 * A descriptor that has been awarded is part of a card the school has issued.
 * The API answers a delete with the count and this screen shows it; archiving
 * is then one press, and hides the descriptor from every picker while leaving
 * every historical sheet exactly as it was issued.
 */

export interface ExamSettingsEditorProps {
  subcategories: readonly ResultSubcategoryRow[];
  settings: ExamSettings;
  canWrite: boolean;
}

export function ExamSettingsEditor({
  subcategories,
  settings,
  canWrite,
}: ExamSettingsEditorProps) {
  const router = useRouter();

  const [label, setLabel] = useState('');
  const [colorHex, setColorHex] = useState('#22C55E');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftColor, setDraftColor] = useState('#22C55E');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const active = subcategories.filter((row) => !row.isArchived);
  const archived = subcategories.filter((row) => row.isArchived);

  // The same function the API validates with, so the screen and the server
  // cannot disagree about what a usable descriptor is.
  const problem = subcategoryProblem(
    label,
    colorHex,
    active.map((row) => row.label.trim().toLowerCase()),
  );

  const run = async (key: string, work: () => Promise<void>): Promise<void> => {
    setBusy(key);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That did not work.'));
    } finally {
      setBusy(null);
    }
  };

  const create = (): Promise<void> =>
    run('create', async () => {
      await schoolFetch('/api/school/result-subcategories', {
        method: 'POST',
        body: JSON.stringify({ label, colorHex }),
      });
      setLabel('');
    });

  const saveEdit = (id: string): Promise<void> =>
    run(`save:${id}`, async () => {
      await schoolFetch(`/api/school/result-subcategories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ label: draftLabel, colorHex: draftColor }),
      });
      setEditingId(null);
    });

  const setArchived = (id: string, isArchived: boolean): Promise<void> =>
    run(`archive:${id}`, async () => {
      await schoolFetch(`/api/school/result-subcategories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isArchived }),
      });
    });

  const remove = (row: ResultSubcategoryRow): Promise<void> =>
    run(`delete:${row.id}`, async () => {
      await schoolFetch(`/api/school/result-subcategories/${row.id}`, {
        method: 'DELETE',
      });
    });

  const move = (index: number, direction: -1 | 1): Promise<void> | void => {
    const target = index + direction;
    if (target < 0 || target >= active.length) return;

    const reordered = [...active];
    const [moved] = reordered.splice(index, 1);
    if (moved === undefined) return;
    reordered.splice(target, 0, moved);

    return run(`move:${moved.id}`, async () => {
      await schoolFetch('/api/school/result-subcategories/reorder', {
        method: 'PATCH',
        body: JSON.stringify({
          subcategories: reordered.map((row, position) => ({
            id: row.id,
            sortOrder: position,
          })),
        }),
      });
    });
  };

  const setSwitch = (
    key: 'colorCodingEnabled' | 'teachersCanViewLegacyResults',
    value: boolean,
  ): Promise<void> =>
    run(key, async () => {
      await schoolFetch('/api/school/exam-settings', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      });
    });

  return (
    <div className="space-y-6">
      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      <Card
        header={
          <CardTitle
            title="Result sub-categories"
            description="The words a school uses instead of a mark, best first."
          />
        }
      >
        {canWrite ? (
          <div className="mb-5 grid items-end gap-4 rounded-lg border border-line bg-surface-sunken p-4 sm:grid-cols-2 xl:grid-cols-4">
            <Input
              label="Label"
              value={label}
              maxLength={SUBCATEGORY_LABEL_MAX}
              placeholder="Working Towards"
              error={label.trim() === '' ? undefined : (problem ?? undefined)}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
            />
            <Input
              label="Colour"
              type="color"
              value={normalizeHex(colorHex) ?? '#22C55E'}
              onChange={(event) => {
                setColorHex(event.target.value);
              }}
            />
            <div>
              <p className="mb-1 block text-sm font-medium text-ink">Preview</p>
              <SubcategoryBadge
                subcategory={{
                  id: 'preview',
                  label: label.trim() === '' ? 'Sub-category' : label.trim(),
                  colorHex,
                }}
                colorCoded={settings.colorCodingEnabled}
              />
            </div>
            <Button
              isLoading={busy === 'create'}
              disabled={problem !== null}
              onClick={() => {
                void create();
              }}
            >
              Add sub-category
            </Button>
          </div>
        ) : null}

        {active.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No sub-categories. A class judged on descriptors has nothing to
            choose from until there is at least one.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((row, index) => (
              <li key={row.id} className="py-3">
                {editingId === row.id ? (
                  <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Input
                      label="Label"
                      value={draftLabel}
                      maxLength={SUBCATEGORY_LABEL_MAX}
                      onChange={(event) => {
                        setDraftLabel(event.target.value);
                      }}
                    />
                    <Input
                      label="Colour"
                      type="color"
                      value={normalizeHex(draftColor) ?? '#22C55E'}
                      onChange={(event) => {
                        setDraftColor(event.target.value);
                      }}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        isLoading={busy === `save:${row.id}`}
                        onClick={() => {
                          void saveEdit(row.id);
                        }}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditingId(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <SubcategoryBadge
                      subcategory={row}
                      colorCoded={settings.colorCodingEnabled}
                    />

                    {canWrite ? (
                      <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${row.label} up`}
                          disabled={index === 0 || busy !== null}
                          onClick={() => {
                            void move(index, -1);
                          }}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${row.label} down`}
                          disabled={index === active.length - 1 || busy !== null}
                          onClick={() => {
                            void move(index, 1);
                          }}
                        >
                          ↓
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditingId(row.id);
                            setDraftLabel(row.label);
                            setDraftColor(row.colorHex ?? '#22C55E');
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          isLoading={busy === `archive:${row.id}`}
                          onClick={() => {
                            void setArchived(row.id, true);
                          }}
                        >
                          Archive
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          isLoading={busy === `delete:${row.id}`}
                          onClick={() => {
                            void remove(row);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {archived.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <h4 className="text-sm font-semibold text-ink">Archived</h4>
            <p className="mt-1 text-xs text-ink-muted">
              Hidden from every picker. Results already awarded still render
              them exactly as they were issued.
            </p>
            <ul className="mt-3 space-y-2">
              {archived.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <SubcategoryBadge
                      subcategory={row}
                      colorCoded={settings.colorCodingEnabled}
                    />
                    <Badge variant="neutral">Archived</Badge>
                  </span>
                  {canWrite ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      isLoading={busy === `archive:${row.id}`}
                      onClick={() => {
                        void setArchived(row.id, false);
                      }}
                    >
                      Restore
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card
        header={
          <CardTitle
            title="Exam settings"
            description="Two decisions that apply to the whole school."
          />
        }
      >
        <div className="space-y-5">
          <Toggle
            label="Enable colour coding"
            description="Paints every sub-category in the colour chosen for it, on screen and in print. Switching it off is retroactive: every sheet the school has ever issued renders as plain text from that moment."
            checked={settings.colorCodingEnabled}
            disabled={!canWrite || busy === 'colorCodingEnabled'}
            onChange={(next) => {
              void setSwitch('colorCodingEnabled', next);
            }}
          />
          <Toggle
            label="Allow teachers to view student legacy results"
            description="Whether a teacher may open a child's results from previous academic years. Off by default. School admins, branch admins and principals always have full access."
            checked={settings.teachersCanViewLegacyResults}
            disabled={!canWrite || busy === 'teachersCanViewLegacyResults'}
            onChange={(next) => {
              void setSwitch('teachersCanViewLegacyResults', next);
            }}
          />
        </div>
      </Card>
    </div>
  );
}
