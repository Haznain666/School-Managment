'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';

import {
  PalettePreview,
  PaletteSwatches,
} from '@/components/super-admin/PalettePreview';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { Palette } from '@/db/schema';
import { superAdminFetch, superAdminUpload, SuperAdminApiError } from '@/lib/super-admin-client';
import { cn } from '@/lib/utils';

export interface BrandingManagerProps {
  schoolId: string;
}

interface BrandingResponse {
  palettes: Array<Palette | null>;
  selectedPalette: number;
  logoUrl: string | null;
}

const PALETTE_NAMES = ['Vibrant', 'Muted', 'Auto-complementary'];
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];

export function BrandingManager({ schoolId }: BrandingManagerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [palettes, setPalettes] = useState<Array<Palette | null>>([]);
  const [selected, setSelected] = useState(0);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
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

  const upload = useCallback(
    async (file: File) => {
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

      setIsUploading(true);

      const form = new FormData();
      form.append('logo', file);

      try {
        const result = await superAdminUpload<{
          logoUrl: string;
          palettes: Palette[];
          selectedPalette: number;
        }>(`/api/super-admin/schools/${schoolId}/branding/upload`, form);

        setLogoUrl(result.logoUrl);
        setPalettes(result.palettes);
        setSelected(result.selectedPalette);
        setNotice('Logo uploaded. Pick the palette you want to go live.');
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
    [schoolId],
  );

  const handleFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file !== undefined) void upload(file);
      // Reset so re-selecting the same file fires change again.
      event.target.value = '';
    },
    [upload],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files[0];
      if (file !== undefined) void upload(file);
    },
    [upload],
  );

  const handleSelect = useCallback(
    async (index: number) => {
      setPendingIndex(index);
      setError(null);
      setNotice(null);

      try {
        await superAdminFetch(`/api/super-admin/schools/${schoolId}/branding`, {
          method: 'PATCH',
          body: JSON.stringify({ selectedPalette: index }),
        });
        setSelected(index);
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
            isLoading={isUploading}
            onClick={() => {
              inputRef.current?.click();
            }}
          >
            {isUploading ? 'Uploading…' : 'Choose file'}
          </Button>
        </div>
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

      {hasPalettes ? (
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Palettes
          </h3>

          <div className="grid gap-4 lg:grid-cols-3">
            {palettes.map((palette, index) => {
              if (palette == null) return null;
              const isActive = index === selected;

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
                    disabled={isActive || pendingIndex !== null}
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
