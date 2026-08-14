'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { PalettePreview } from '@/components/super-admin/PalettePreview';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import type { Palette } from '@/db/schema';
import { DERIVED_PALETTE_NAMES, PALETTE_PRESETS } from '@/lib/palette-presets';
import { cn } from '@/lib/utils';
import { schoolErrorMessage, schoolFetch, withSchoolParam } from '@/lib/school-client';

/**
 * The school's logo and colours, changed by the school.
 *
 * ── Why the page reloads after a change ──────────────────────────────────
 * The palette is applied as CSS variables on the portal shell, which is a
 * server component. Swapping it here would leave the preview showing one thing
 * and the surrounding page another until the next navigation — so a successful
 * save refreshes, and the whole portal comes back in the new colours. That is
 * also the only honest confirmation: an administrator asked for the school to
 * look different, and it does.
 *
 * ── Why the upload is a plain form post rather than `schoolFetch` ────────
 * The body is `FormData`, so no `Content-Type` may be set — the browser has to
 * add its own multipart boundary. `schoolFetch` already leaves FormData
 * untouched for exactly this reason; the raw call here is only so the file
 * input can be reset on failure.
 *
 * ── Why the presets are on this page at all ──────────────────────────────
 * They were Super Admin's alone, and this page did not even read `presetKey` —
 * so a school themed from a preset saw one of its logo palettes labelled "in
 * use" while the portal around it was painted in something else entirely. The
 * honest fix is not a caption: the page has to show every choice the setting
 * can hold, or it will keep pointing at the wrong one.
 */

interface BrandingResponse {
  logoUrl: string | null;
  palettes: Array<Palette | null>;
  selectedPalette: number;
  /** A curated preset, when one is chosen. It outranks `selectedPalette`. */
  presetKey: string | null;
  activePalette: Palette | null;
}

export interface SchoolBrandingFormProps {
  schoolName: string;
  canEdit: boolean;
}

const PALETTE_NAMES = DERIVED_PALETTE_NAMES;

export function SchoolBrandingForm({ schoolName, canEdit }: SchoolBrandingFormProps) {
  const [branding, setBranding] = useState<BrandingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const payload = await schoolFetch<BrandingResponse>('/api/school/branding');
      setBranding(payload);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load your branding.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File): Promise<void> => {
    setBusy('upload');
    setError(null);
    setNotice(null);

    const form = new FormData();
    form.append('logo', file);

    try {
      const response = await fetch(withSchoolParam('/api/school/branding/upload'), {
        method: 'POST',
        body: form,
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };

      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error?.message ?? 'The upload failed.');
      }

      setNotice('Logo uploaded. Three palettes were generated from it — pick one.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The upload failed.');
    } finally {
      // Cleared either way, so the same file can be retried after a failure —
      // a file input holding the rejected file fires no change event on
      // re-selection, and the retry silently does nothing.
      if (fileInput.current !== null) fileInput.current.value = '';
      setBusy(null);
    }
  };

  /**
   * Applies one choice, whichever half of the setting it comes from.
   *
   * Selecting a derived palette sends `presetKey: null` explicitly — that is
   * what clears a preset. Absent and null are different to the route, and
   * sending nothing would leave the preset in place, outranking the palette
   * just chosen and making the click appear to do nothing.
   */
  const apply = async (
    key: string,
    body: { selectedPalette: number; presetKey: null } | { presetKey: string },
  ): Promise<void> => {
    setBusy(key);
    setError(null);
    setNotice(null);

    try {
      await schoolFetch('/api/school/branding', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      // A full reload, not a router refresh: the palette lives in CSS variables
      // set by the portal shell, above this component's tree.
      window.location.reload();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not apply that palette.'));
      setBusy(null);
    }
  };

  return (
    <Card
      header={
        <CardTitle
          title="Logo and colours"
          description="Upload your logo and the portal takes its colours from it."
        />
      }
    >
      {error !== null ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="mb-4 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      {branding === null ? (
        <p className="text-sm text-ink-muted">Loading branding…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-6">
            {branding.logoUrl === null || branding.logoUrl === '' ? (
              <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-line-strong text-xs text-ink-muted">
                No logo
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt={`${schoolName} logo`}
                className="h-24 w-24 rounded-lg border border-line bg-surface-raised object-contain p-1"
              />
            )}

            <div className="flex-1">
              <p className="text-sm text-ink-muted">
                PNG, JPG, SVG or WebP, up to 2 MB. A new logo replaces the old
                one and regenerates the three palettes below, which resets your
                colour choice.
              </p>

              {canEdit ? (
                <div className="mt-3">
                  <label
                    htmlFor="school-logo"
                    className="mb-1.5 block text-sm font-medium text-ink"
                  >
                    Upload a logo
                  </label>
                  <input
                    id="school-logo"
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    disabled={busy !== null}
                    className={cn(
                      'block w-full text-sm text-ink-muted',
                      'file:mr-3 file:rounded-lg file:border-0 file:bg-brand-primary',
                      'file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-onPrimary',
                      'hover:file:opacity-90 disabled:cursor-not-allowed disabled:opacity-60',
                    )}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file !== undefined) void upload(file);
                    }}
                  />
                  {busy === 'upload' ? (
                    <p className="mt-2 text-sm text-ink-muted">
                      Uploading and reading the colours out of your logo…
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-ink">Preset palettes</h3>
            <p className="mt-1 text-sm text-ink-muted">
              Curated, and available whether or not you have uploaded a logo. A
              preset overrides the palettes taken from your logo.
            </p>

            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {PALETTE_PRESETS.map((preset) => {
                const isActive = branding.presetKey === preset.key;

                return (
                  <div key={preset.key} className="space-y-2">
                    <PalettePreview palette={preset.palette} />
                    <Button
                      fullWidth
                      size="sm"
                      variant={isActive ? 'primary' : 'secondary'}
                      disabled={!canEdit || isActive}
                      isLoading={busy === `preset-${preset.key}`}
                      onClick={() => {
                        void apply(`preset-${preset.key}`, { presetKey: preset.key });
                      }}
                    >
                      {isActive ? `${preset.name} — in use` : `Use ${preset.name}`}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-ink">From your logo</h3>

            {branding.palettes.every((palette) => palette === null) ? (
              <p className="mt-1 text-sm text-ink-muted">
                Upload a logo and three palettes will be generated from it.
              </p>
            ) : (
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                {branding.palettes.map((palette, index) => {
                  if (palette === null) return null;

                  // Only one palette is live at a time and a preset outranks
                  // these, so none of them is "in use" while one is set —
                  // which is exactly what this page used to get wrong.
                  const isActive =
                    branding.presetKey === null && branding.selectedPalette === index;

                  const name = PALETTE_NAMES[index] ?? `palette ${index + 1}`;

                  return (
                    <div key={index} className="space-y-2">
                      <PalettePreview palette={palette} />
                      <Button
                        fullWidth
                        size="sm"
                        variant={isActive ? 'primary' : 'secondary'}
                        disabled={!canEdit || isActive}
                        isLoading={busy === `palette-${index}`}
                        onClick={() => {
                          void apply(`palette-${index}`, {
                            selectedPalette: index,
                            presetKey: null,
                          });
                        }}
                      >
                        {isActive ? `${name} — in use` : `Use ${name}`}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
