'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/**
 * Frames a logo before it is uploaded.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The upload used to take whatever file it was given and stretch it into a
 * square box wherever a logo appears. A wide crest came out squashed, a logo
 * with generous whitespace came out tiny, and a transparent PNG designed for a
 * dark header vanished on the white letterhead. None of that is fixable after
 * the fact, because the stored object *is* what every surface renders.
 *
 * So the framing decision moves to the person who can see the logo: they pan,
 * zoom and choose a backdrop, and what they approve is what is stored.
 *
 * ── Why it renders to a canvas rather than storing a transform ───────────
 * A transform would have to be re-applied by every consumer — the portal
 * shell, the login page, the invite page, four printed documents — and each
 * one is a different rendering context. `PrintLetterhead` is `<img>` inside a
 * print stylesheet; there is nowhere sensible to put a crop matrix. Baking the
 * framing into the pixels means every existing consumer keeps working
 * untouched, which is why nothing outside this component and the upload route
 * changed.
 *
 * The cost, stated plainly: framing is destructive and not re-editable. Going
 * back means choosing the original file again. That is the right trade at this
 * size — the alternative is storing an original *and* a rendered copy, and a
 * second object to keep in step with the first.
 *
 * ── Output ───────────────────────────────────────────────────────────────
 * Always a square PNG at `OUTPUT_SIZE`, regardless of what went in. Square
 * because every consumer already boxes the logo square; PNG because it is the
 * one format in the accepted set that keeps transparency and needs no quality
 * decision. The upload route re-derives the palettes from these pixels, so the
 * colours follow the visible logo rather than a cropped-away corner.
 */

/**
 * Stored edge length. 512 is comfortably above the largest place a logo is
 * shown (an 80px avatar at 3x is 240) and below the point where a PNG of a
 * simple mark starts costing real bytes against the 2 MB ceiling.
 */
const OUTPUT_SIZE = 512;

/** On-screen editing surface. Independent of OUTPUT_SIZE — this is just UI. */
const STAGE_SIZE = 288;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

export type LogoBackdrop = 'transparent' | 'white' | 'dark';

const BACKDROPS: ReadonlyArray<{
  value: LogoBackdrop;
  label: string;
  hint: string;
  /** null keeps the alpha channel. */
  fill: string | null;
}> = [
  {
    value: 'transparent',
    label: 'Transparent',
    hint: 'Keeps the alpha channel. Best when the mark is dark.',
    fill: null,
  },
  {
    value: 'white',
    label: 'White',
    hint: 'Flattens onto white — matches the printed letterhead.',
    fill: '#ffffff',
  },
  {
    value: 'dark',
    label: 'Dark',
    hint: 'For a logo drawn in white, which would otherwise vanish.',
    fill: '#0f172a',
  },
];

export interface LogoCanvasEditorProps {
  /** The file the operator chose. */
  file: File;
  isSaving: boolean;
  onCancel: () => void;
  /** Receives the framed square PNG, ready to upload. */
  onConfirm: (framed: Blob) => void;
}

interface Offset {
  x: number;
  y: number;
}

export function LogoCanvasEditor({
  file,
  isSaving,
  onCancel,
  onConfirm,
}: LogoCanvasEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragFrom = useRef<{ pointer: Offset; offset: Offset } | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [backdrop, setBackdrop] = useState<LogoBackdrop>('transparent');

  const objectUrl = useMemo(() => URL.createObjectURL(file), [file]);

  /**
   * The zoom at which the whole image is visible inside the square. Every
   * other zoom is expressed as a multiple of this, so the slider means the
   * same thing for a wide banner and a tall crest.
   */
  const [baseScale, setBaseScale] = useState(1);

  useEffect(() => {
    const image = new Image();

    // The object URL is same-origin, so the canvas is never tainted and
    // toBlob() works. This is exactly why the editor operates on the chosen
    // File rather than on the already-uploaded logo, which lives on the
    // Supabase origin.
    image.onload = () => {
      imageRef.current = image;

      // An SVG with no intrinsic size decodes as 0x0 in some browsers; treat
      // it as square rather than dividing by zero below.
      const width = image.naturalWidth || OUTPUT_SIZE;
      const height = image.naturalHeight || OUTPUT_SIZE;

      setBaseScale(Math.min(OUTPUT_SIZE / width, OUTPUT_SIZE / height));
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setIsReady(true);
    };

    image.onerror = () => {
      setLoadError('That image could not be read. Try a PNG, JPG or WebP.');
    };

    image.src = objectUrl;

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  /**
   * Paints one frame at a given edge length.
   *
   * The same function drives the on-screen stage and the exported file, which
   * is what makes the preview trustworthy: there is no second code path where
   * the output could differ from what was approved. Offsets are held in output
   * pixels and scaled by `size / OUTPUT_SIZE` so the two agree exactly.
   */
  const paint = useCallback(
    (canvas: HTMLCanvasElement, size: number) => {
      const image = imageRef.current;
      const context = canvas.getContext('2d');
      if (image === null || context === null) return;

      const ratio = size / OUTPUT_SIZE;

      canvas.width = size;
      canvas.height = size;
      context.clearRect(0, 0, size, size);

      const fill = BACKDROPS.find((entry) => entry.value === backdrop)?.fill ?? null;
      if (fill !== null) {
        context.fillStyle = fill;
        context.fillRect(0, 0, size, size);
      }

      const width = image.naturalWidth || OUTPUT_SIZE;
      const height = image.naturalHeight || OUTPUT_SIZE;

      const drawWidth = width * baseScale * zoom * ratio;
      const drawHeight = height * baseScale * zoom * ratio;

      // Centre, then apply the pan.
      const left = (size - drawWidth) / 2 + offset.x * ratio;
      const top = (size - drawHeight) / 2 + offset.y * ratio;

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, left, top, drawWidth, drawHeight);
    },
    [backdrop, baseScale, offset.x, offset.y, zoom],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !isReady) return;
    paint(canvas, STAGE_SIZE);
  }, [isReady, paint]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragFrom.current = {
        pointer: { x: event.clientX, y: event.clientY },
        offset,
      };
    },
    [offset],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const start = dragFrom.current;
      if (start === null) return;

      // Screen pixels to output pixels, so dragging tracks the cursor exactly.
      const ratio = OUTPUT_SIZE / STAGE_SIZE;

      setOffset({
        x: start.offset.x + (event.clientX - start.pointer.x) * ratio,
        y: start.offset.y + (event.clientY - start.pointer.y) * ratio,
      });
    },
    [],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragFrom.current = null;
  }, []);

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const confirm = useCallback(() => {
    const image = imageRef.current;
    if (image === null) return;

    // Painted fresh at full size rather than upscaled from the stage, so the
    // stored logo is not a blurry 288px enlargement.
    const output = document.createElement('canvas');
    paint(output, OUTPUT_SIZE);

    output.toBlob((blob) => {
      if (blob !== null) onConfirm(blob);
    }, 'image/png');
  }, [onConfirm, paint]);

  if (loadError !== null) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Choose another file
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="shrink-0">
          <div
            className={cn(
              'relative overflow-hidden rounded-lg border border-slate-300',
              // The chequerboard reads as "transparent" the way every image
              // editor does it, so an operator can tell an empty corner from a
              // white one before it reaches a printed page.
              backdrop === 'transparent' &&
                'bg-[length:16px_16px] bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%,transparent_75%,#e2e8f0_75%),linear-gradient(45deg,#e2e8f0_25%,transparent_25%,transparent_75%,#e2e8f0_75%)] bg-[position:0_0,8px_8px]',
            )}
            style={{ width: STAGE_SIZE, height: STAGE_SIZE }}
          >
            <canvas
              ref={canvasRef}
              width={STAGE_SIZE}
              height={STAGE_SIZE}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="touch-none cursor-grab active:cursor-grabbing"
            />
          </div>
          <p className="mt-2 text-center text-xs text-slate-500">
            Drag the logo to reposition it.
          </p>
        </div>

        <div className="flex-1 space-y-4">
          <div>
            <label
              htmlFor="logo-zoom"
              className="flex items-center justify-between text-sm font-medium text-slate-900"
            >
              Zoom
              <span className="text-xs font-normal tabular-nums text-slate-500">
                {Math.round(zoom * 100)}%
              </span>
            </label>
            <input
              id="logo-zoom"
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(event) => {
                setZoom(Number(event.target.value));
              }}
              className="mt-2 w-full accent-brand-primary"
            />
            <p className="mt-1 text-xs text-slate-500">
              100% fits the whole image inside the square.
            </p>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-slate-900">Backdrop</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {BACKDROPS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  title={entry.hint}
                  aria-pressed={backdrop === entry.value}
                  onClick={() => {
                    setBackdrop(entry.value);
                  }}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition',
                    backdrop === entry.value
                      ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {BACKDROPS.find((entry) => entry.value === backdrop)?.hint}
            </p>
          </fieldset>

          <button
            type="button"
            onClick={reset}
            className="text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            Reset framing
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
        <Button size="sm" isLoading={isSaving} disabled={!isReady} onClick={confirm}>
          {isSaving ? 'Uploading…' : 'Save logo'}
        </Button>
        <Button size="sm" variant="secondary" disabled={isSaving} onClick={onCancel}>
          Cancel
        </Button>
        <p className="text-xs text-slate-500">
          Saved as a {OUTPUT_SIZE}×{OUTPUT_SIZE} PNG. Framing cannot be changed
          afterwards — choose the file again to redo it.
        </p>
      </div>
    </div>
  );
}
