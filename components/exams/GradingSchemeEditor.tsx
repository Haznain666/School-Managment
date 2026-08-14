'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { bandsProblem, SUGGESTED_BANDS, type ResolvedBand } from '@/lib/grading';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The school's own grading ladders.
 *
 * `bandsProblem` from `lib/grading.ts` validates here and again in the API —
 * the same function, not two implementations of the same rule. That is the
 * whole reason the grading module is dependency-free.
 *
 * Bands are saved as a set, never one at a time: a ladder with a hole in it
 * gives some percentage no grade at all, and a report card with a blank grade
 * reads as a broken system rather than a half-finished edit.
 */

export interface SchemeRow {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  bands: (ResolvedBand & { id: string })[];
}

export interface GradingSchemeEditorProps {
  schemes: readonly SchemeRow[];
  canWrite: boolean;
}

interface BandDraft {
  label: string;
  minPercentage: string;
  maxPercentage: string;
  gpa: string;
  remark: string;
}

function toDrafts(bands: readonly ResolvedBand[]): BandDraft[] {
  return bands.map((band) => ({
    label: band.label,
    minPercentage: String(band.minPercentage),
    maxPercentage: String(band.maxPercentage),
    gpa: band.gpa === null ? '' : String(band.gpa),
    remark: band.remark ?? '',
  }));
}

function fromDrafts(drafts: readonly BandDraft[]): ResolvedBand[] {
  return drafts.map((draft) => ({
    label: draft.label.trim(),
    minPercentage: Number.parseFloat(draft.minPercentage),
    maxPercentage: Number.parseFloat(draft.maxPercentage),
    gpa: draft.gpa.trim() === '' ? null : Number.parseFloat(draft.gpa),
    remark: draft.remark.trim() === '' ? null : draft.remark.trim(),
  }));
}

export function GradingSchemeEditor({ schemes, canWrite }: GradingSchemeEditorProps) {
  const router = useRouter();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<BandDraft[]>(toDrafts(SUGGESTED_BANDS));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const problem = bandsProblem(fromDrafts(drafts));

  const startCreate = (): void => {
    setIsCreating(true);
    setEditingId(null);
    setName('');
    setDrafts(toDrafts(SUGGESTED_BANDS));
    setError(null);
  };

  const startEdit = (scheme: SchemeRow): void => {
    setIsCreating(false);
    setEditingId(scheme.id);
    setName(scheme.name);
    setDrafts(toDrafts(scheme.bands));
    setError(null);
  };

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

  const save = (): Promise<void> =>
    run('save', async () => {
      const body = JSON.stringify({ name, bands: fromDrafts(drafts) });

      if (editingId === null) {
        await schoolFetch('/api/school/grading-schemes', { method: 'POST', body });
      } else {
        await schoolFetch(`/api/school/grading-schemes/${editingId}`, {
          method: 'PATCH',
          body,
        });
      }

      setIsCreating(false);
      setEditingId(null);
    });

  const makeDefault = (schemeId: string): Promise<void> =>
    run(`default-${schemeId}`, async () => {
      await schoolFetch(`/api/school/grading-schemes/${schemeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      });
    });

  const isEditing = isCreating || editingId !== null;

  return (
    <div className="space-y-4">
      <Card
        header={
          <CardTitle
            title="Grading schemes"
            description="Bands, letters and GPA — the school's own, never the platform's."
            action={
              canWrite ? (
                <Button
                  size="sm"
                  variant={isEditing ? 'secondary' : 'primary'}
                  onClick={() => {
                    if (isEditing) {
                      setIsCreating(false);
                      setEditingId(null);
                    } else {
                      startCreate();
                    }
                  }}
                >
                  {isEditing ? 'Cancel' : 'New scheme'}
                </Button>
              ) : undefined
            }
          />
        }
      >
        {error !== null ? (
          <p role="alert" className="mb-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
            {error}
          </p>
        ) : null}

        {/* A school with schemes but no active default grades exactly like a
            school with none — a dash everywhere — and the two are impossible to
            tell apart from a report card. The API now makes a first scheme the
            default, so this only shows for a school whose default was retired
            or which predates that rule; saying so beats leaving them to wonder
            why their bands do nothing. */}
        {schemes.length > 0 &&
        !schemes.some((scheme) => scheme.isDefault && scheme.isActive) ? (
          <p className="mb-4 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
            None of these schemes is the active default, so report cards and
            tabulation sheets are printing a dash for every grade. Choose one
            with <strong>Make default</strong>.
          </p>
        ) : null}

        {schemes.length === 0 && !isEditing ? (
          <p className="text-sm text-ink-muted">
            No grading scheme yet, so report cards will print marks and
            percentages but no letter grades. That is a real state, not a
            failure — until the school says what an A is, nothing here is
            entitled to guess.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {schemes.map((scheme) => (
              <li
                key={scheme.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{scheme.name}</p>
                  <p className="text-xs text-ink-muted">
                    {scheme.bands
                      .map((band) => `${band.label} ${band.minPercentage}+`)
                      .join(' · ')}
                  </p>
                </div>

                <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                  {scheme.isDefault ? <Badge variant="success">Default</Badge> : null}
                  {scheme.isActive ? null : <Badge variant="neutral">Retired</Badge>}

                  {canWrite && !scheme.isDefault ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={busy === `default-${scheme.id}`}
                      onClick={() => {
                        void makeDefault(scheme.id);
                      }}
                    >
                      Make default
                    </Button>
                  ) : null}

                  {canWrite ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        startEdit(scheme);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isEditing ? (
        <Card
          header={
            <CardTitle
              title={editingId === null ? 'New scheme' : 'Edit scheme'}
              description="Bands are saved as a set. The highest band a percentage reaches wins."
            />
          }
        >
          <div className="space-y-4">
            <div className="sm:max-w-sm">
              <Input
                label="Scheme name"
                value={name}
                placeholder="Matric"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </div>

            <div className="overflow-x-auto">
              <Table caption="Grade bands" className="rounded-none border-0">
                <TableHead>
                  <TableRow className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                    <TableHeaderCell className="pr-3">Grade</TableHeaderCell>
                    <TableHeaderCell className="pr-3">From %</TableHeaderCell>
                    <TableHeaderCell className="pr-3">To %</TableHeaderCell>
                    <TableHeaderCell className="pr-3">GPA</TableHeaderCell>
                    <TableHeaderCell className="pr-3">Remark</TableHeaderCell>
                    <TableHeaderCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {drafts.map((draft, index) => (
                    // The index is the identity here on purpose: these rows have
                    // no id until they are saved, and reordering is not offered.
                    <TableRow key={index}>
                      {(
                        [
                          ['label', 'w-24'],
                          ['minPercentage', 'w-20'],
                          ['maxPercentage', 'w-20'],
                          ['gpa', 'w-20'],
                          ['remark', 'w-40'],
                        ] as const
                      ).map(([field, width]) => (
                        <TableCell className="pr-3" key={field}>
                          <input
                            value={draft[field]}
                            aria-label={`${field} for band ${index + 1}`}
                            onChange={(event) => {
                              const next = event.target.value;
                              setDrafts((current) =>
                                current.map((row, position) =>
                                  position === index ? { ...row, [field]: next } : row,
                                ),
                              );
                            }}
                            className={`${width} rounded-lg border border-line-strong px-2 py-1.5 text-sm`}
                          />
                        </TableCell>
                      ))}
                      <TableCell align="numeric">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDrafts((current) =>
                              current.filter((_, position) => position !== index),
                            );
                          }}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setDrafts((current) => [
                    ...current,
                    {
                      label: '',
                      minPercentage: '',
                      maxPercentage: '',
                      gpa: '',
                      remark: '',
                    },
                  ]);
                }}
              >
                Add a band
              </Button>

              <Button
                isLoading={busy === 'save'}
                disabled={problem !== null || name.trim() === ''}
                onClick={() => {
                  void save();
                }}
              >
                Save scheme
              </Button>

              {problem === null ? null : (
                <p className="text-sm text-status-warning-ink">{problem}</p>
              )}
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
