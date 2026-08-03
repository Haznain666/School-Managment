'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { PalettePreview } from '@/components/super-admin/PalettePreview';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import type { Palette } from '@/db/schema';
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
 */

interface BrandingResponse {
  logoUrl: string | null;
  palettes: Array<Palette | null>;
  selectedPalette: number;
  activePalette: Palette | null;
}

export interface SchoolBrandingFormProps {
  schoolName: string;
  canEdit: boolean;
}

const PALETTE_NAMES = ['Vibrant', 'Muted', 'Balanced'] as const;

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

  const choose = async (index: number): Promise<void> => {
    setBusy(`palette-${index}`);
    setError(null);
    setNotice(null);

    try {
      await schoolFetch('/api/school/branding', {
        method: 'PATCH',
        body: JSON.stringify({ selectedPalette: index }),
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
          className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      {branding === null ? (
        <p className="text-sm text-slate-500">Loading branding…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-6">
            {branding.logoUrl === null || branding.logoUrl === '' ? (
              <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
                No logo
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt={`${schoolName} logo`}
                className="h-24 w-24 rounded-lg border border-slate-200 bg-white object-contain p-1"
              />
            )}

            <div className="flex-1">
              <p className="text-sm text-slate-600">
                PNG, JPG, SVG or WebP, up to 2 MB. A new logo replaces the old
                one and regenerates the three palettes below, which resets your
                colour choice.
              </p>

              {canEdit ? (
                <div className="mt-3">
                  <label
                    htmlFor="school-logo"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
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
                      'block w-full text-sm text-slate-600',
                      'file:mr-3 file:rounded-lg file:border-0 file:bg-brand-primary',
                      'file:px-4 file:py-2 file:text-sm file:font-medium file:text-white',
                      'hover:file:opacity-90 disabled:cursor-not-allowed disabled:opacity-60',
                    )}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file !== undefined) void upload(file);
                    }}
                  />
                  {busy === 'upload' ? (
                    <p className="mt-2 text-sm text-slate-500">
                      Uploading and reading the colours out of your logo…
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-900">Colour palette</h3>

            {branding.palettes.every((palette) => palette === null) ? (
              <p className="mt-1 text-sm text-slate-500">
                Upload a logo and three palettes will be generated from it.
              </p>
            ) : (
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                {branding.palettes.map((palette, index) => {
                  if (palette === null) return null;

                  const isActive = branding.selectedPalette === index;

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
                          void choose(index);
                        }}
                      >
                        {isActive
                          ? `${PALETTE_NAMES[index] ?? `Palette ${index + 1}`} — in use`
                          : `Use ${PALETTE_NAMES[index] ?? `palette ${index + 1}`}`}
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
