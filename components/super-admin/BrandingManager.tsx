'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';

import { LogoCanvasEditor } from '@/components/super-admin/LogoCanvasEditor';
import {
  PalettePreview,
  PaletteSwatches,
} from '@/components/super-admin/PalettePreview';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { Palette } from '@/db/schema';
import { DERIVED_PALETTE_NAMES, PALETTE_PRESETS } from '@/lib/palette-presets';
import { superAdminFetch, superAdminUpload, SuperAdminApiError } from '@/lib/super-admin-client';
import { cn } from '@/lib/utils';

export interface BrandingManagerProps {
  schoolId: string;
}

interface BrandingResponse {
  palettes: Array<Palette | null>;
  selectedPalette: number;
  presetKey: string | null;
  logoUrl: string | null;
}

const PALETTE_NAMES = DERIVED_PALETTE_NAMES;
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];

export function BrandingManager({ schoolId }: BrandingManagerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [palettes, setPalettes] = useState<Array<Palette | null>>([]);
  const [selected, setSelected] = useState(0);
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  /**
   * The file being framed, before it becomes an upload. Holding it here rather
   * than uploading on selection is the whole point of the editor: nothing
   * reaches Storage until the operator has approved what it will look like.
   */
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [pendingPreset, setPendingPreset] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void superAdminFetch<BrandingResponse>(
      `/api/super-admin/schools/${schoolId}/branding`,
    )
      .then((data) => {
        if (cancelled) return;
        setPalettes(data.palettes);
        setSelected(data.selectedPalette);
        setPresetKey(data.presetKey);
        setLogoUrl(data.logoUrl);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load branding.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  /**
   * Accepts a chosen file into the editor. Nothing is uploaded here — the
   * operator frames it first, and `uploadFramed` sends what they approved.
   */
  const chooseFile = useCallback((file: File) => {
    setError(null);
    setNotice(null);

    // Checked here for an immediate message; the server enforces it again.
    if (!ACCEPTED.includes(file.type)) {
      setError('Logo must be a PNG, JPG, SVG or WebP image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Logo must be 2 MB or smaller.');
      return;
    }

    setPendingFile(file);
  }, []);

  const uploadFramed = useCallback(
    async (framed: Blob) => {
      setError(null);
      setNotice(null);
      setIsUploading(true);

      const form = new FormData();
      // The editor always emits a square PNG, whatever went in, so the name
      // and type are fixed rather than carried over from the source file.
      form.append('logo', framed, 'logo.png');

      try {
        const result = await superAdminUpload<{
          logoUrl: string;
          palettes: Palette[];
          selectedPalette: number;
        }>(`/api/super-admin/schools/${schoolId}/branding/upload`, form);

        setLogoUrl(result.logoUrl);
        setPalettes(result.palettes);
        setSelected(result.selectedPalette);
        // A new logo re-derives the palettes, and the upload route resets the
        // selection to 0 — but a school sitting on a preset keeps it, because
        // its choice was never about this logo.
        setPendingFile(null);
        setNotice(
          presetKey === null
            ? 'Logo saved. Pick the palette you want to go live.'
            : 'Logo saved. The preset you chose is still active.',
        );
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Upload failed. Please try again.',
        );
      } finally {
        setIsUploading(false);
      }
    },
    [presetKey, schoolId],
  );

  const handleFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file !== undefined) chooseFile(file);
      // Reset so re-selecting the same file fires change again.
      event.target.value = '';
    },
    [chooseFile],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files[0];
      if (file !== undefined) chooseFile(file);
    },
    [chooseFile],
  );

  const handleSelect = useCallback(
    async (index: number) => {
      setPendingIndex(index);
      setError(null);
      setNotice(null);

      try {
        // Sending presetKey: null is what clears a preset. The two choices are
        // one setting with two sources, not two independent switches — a row
        // where both were set would have no defined winner.
        await superAdminFetch(`/api/super-admin/schools/${schoolId}/branding`, {
          method: 'PATCH',
          body: JSON.stringify({ selectedPalette: index, presetKey: null }),
        });
        setSelected(index);
        setPresetKey(null);
        setNotice(`${PALETTE_NAMES[index] ?? 'Palette'} is now active.`);
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not apply that palette.',
        );
      } finally {
        setPendingIndex(null);
      }
    },
    [schoolId],
  );

  const handleSelectPreset = useCallback(
    async (key: string) => {
      setPendingPreset(key);
      setError(null);
      setNotice(null);

      try {
        await superAdminFetch(`/api/super-admin/schools/${schoolId}/branding`, {
          method: 'PATCH',
          body: JSON.stringify({ presetKey: key }),
        });
        setPresetKey(key);
        setNotice(
          `${PALETTE_PRESETS.find((preset) => preset.key === key)?.name ?? 'Preset'} is now active.`,
        );
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Could not apply that preset.',
        );
      } finally {
        setPendingPreset(null);
      }
    },
    [schoolId],
  );

  if (isLoading) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Loading branding…</p>
      </Card>
    );
  }

  const hasPalettes = palettes.some((palette) => palette != null);

  return (
    <div className="space-y-6">
      <Card>
        {pendingFile !== null ? (
          <div>
            <p className="mb-4 text-sm font-medium text-slate-900">
              Frame the logo
            </p>
            <LogoCanvasEditor
              file={pendingFile}
              isSaving={isUploading}
              onCancel={() => {
                setPendingFile(null);
              }}
              onConfirm={(framed) => {
                void uploadFramed(framed);
              }}
            />
          </div>
        ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => {
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition',
            isDragging
              ? 'border-brand-primary bg-brand-primary/5'
              : 'border-slate-300 bg-slate-50',
          )}
        >
          {logoUrl !== null ? (
            // Logo dimensions vary per school; a plain <img> avoids forcing a size.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Current school logo"
              className="mb-4 h-20 w-20 rounded-lg bg-white object-contain p-1 shadow-sm"
            />
          ) : null}

          <p className="text-sm font-medium text-slate-900">
            {logoUrl === null ? 'Upload the school logo' : 'Replace the logo'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Drag and drop, or click to browse. PNG, JPG, SVG or WebP, up to 2 MB.
          </p>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(',')}
            className="sr-only"
            onChange={handleFileInput}
          />

          <Button
            className="mt-4"
            variant="secondary"
            size="sm"
            onClick={() => {
              inputRef.current?.click();
            }}
          >
            Choose file
          </Button>
        </div>
        )}
      </Card>

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

      <div>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Preset palettes
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Curated, and available whether or not a logo has been uploaded. A
          preset overrides the palettes derived from the logo.
        </p>

        <div className="grid gap-4 lg:grid-cols-3">
          {PALETTE_PRESETS.map((preset) => {
            const isActive = presetKey === preset.key;

            return (
              <Card
                key={preset.key}
                className={cn(isActive && 'ring-2 ring-brand-primary')}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{preset.name}</p>
                  {isActive ? <Badge variant="success">Currently Active</Badge> : null}
                </div>
                <p className="mb-3 text-xs text-slate-500">{preset.description}</p>

                <PalettePreview palette={preset.palette} />

                <div className="mt-3">
                  <PaletteSwatches palette={preset.palette} />
                </div>

                <Button
                  className="mt-4"
                  fullWidth
                  variant={isActive ? 'secondary' : 'primary'}
                  disabled={isActive || pendingPreset !== null || pendingIndex !== null}
                  isLoading={pendingPreset === preset.key}
                  onClick={() => {
                    void handleSelectPreset(preset.key);
                  }}
                >
                  {isActive ? 'Selected' : 'Select'}
                </Button>
              </Card>
            );
          })}
        </div>
      </div>

      {hasPalettes ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
            From this logo
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            {presetKey === null
              ? 'Derived from the uploaded logo.'
              : 'Derived from the uploaded logo. Selecting one clears the preset above.'}
          </p>

          <div className="grid gap-4 lg:grid-cols-3">
            {palettes.map((palette, index) => {
              if (palette == null) return null;
              // Only one palette is live at a time, and a preset outranks
              // these — so none of them shows as active while one is set.
              const isActive = presetKey === null && index === selected;

              return (
                <Card
                  key={PALETTE_NAMES[index] ?? index}
                  className={cn(isActive && 'ring-2 ring-brand-primary')}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">
                      {PALETTE_NAMES[index] ?? `Palette ${index + 1}`}
                    </p>
                    {isActive ? <Badge variant="success">Currently Active</Badge> : null}
                  </div>

                  <PalettePreview palette={palette} />

                  <div className="mt-3">
                    <PaletteSwatches palette={palette} />
                  </div>

                  <Button
                    className="mt-4"
                    fullWidth
                    variant={isActive ? 'secondary' : 'primary'}
                    disabled={isActive || pendingIndex !== null || pendingPreset !== null}
                    isLoading={pendingIndex === index}
                    onClick={() => {
                      void handleSelect(index);
                    }}
                  >
                    {isActive ? 'Selected' : 'Select'}
                  </Button>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <Card>
          <p className="text-sm text-slate-600">
            No palettes yet. Upload a logo and three will be generated from it.
          </p>
        </Card>
      )}
    </div>
  );
}
