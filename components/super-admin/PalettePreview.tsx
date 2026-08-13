'use client';

import type { Palette } from '@/db/schema';

export interface PalettePreviewProps {
  palette: Palette;
}

/**
 * Miniature of the school portal — header, sidebar and a card — rendered in a
 * candidate palette.
 *
 * Swatches alone do not tell you whether a palette works; seeing the actual
 * layout catches the cases where, say, a bright accent is unreadable as a
 * header background.
 */
export function PalettePreview({ palette }: PalettePreviewProps) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-line"
      style={{ backgroundColor: palette.background }}
      aria-hidden="true"
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ backgroundColor: palette.primary }}
      >
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: palette.accent }}
        />
        <div
          className="h-1.5 w-16 rounded-full opacity-80"
          style={{ backgroundColor: palette.background }}
        />
      </div>

      <div className="flex h-24">
        {/* Sidebar */}
        <div
          className="flex w-16 shrink-0 flex-col gap-1.5 p-2"
          style={{ backgroundColor: palette.secondary }}
        >
          <div
            className="h-1.5 w-full rounded-full opacity-90"
            style={{ backgroundColor: palette.accent }}
          />
          <div
            className="h-1.5 w-3/4 rounded-full opacity-40"
            style={{ backgroundColor: palette.background }}
          />
          <div
            className="h-1.5 w-2/3 rounded-full opacity-40"
            style={{ backgroundColor: palette.background }}
          />
        </div>

        {/* Content card */}
        <div className="flex-1 p-2.5">
          <div
            className="h-full rounded-md border p-2"
            style={{
              backgroundColor: '#ffffff',
              borderColor: `${palette.secondary}22`,
            }}
          >
            <div
              className="h-1.5 w-2/3 rounded-full"
              style={{ backgroundColor: palette.text }}
            />
            <div
              className="mt-1.5 h-1 w-full rounded-full opacity-30"
              style={{ backgroundColor: palette.text }}
            />
            <div
              className="mt-1 h-1 w-4/5 rounded-full opacity-30"
              style={{ backgroundColor: palette.text }}
            />
            <div
              className="mt-2 h-3 w-12 rounded"
              style={{ backgroundColor: palette.primary }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Row of colour chips with their hex values. */
export function PaletteSwatches({ palette }: PalettePreviewProps) {
  const entries: Array<[string, string]> = [
    ['Primary', palette.primary],
    ['Secondary', palette.secondary],
    ['Accent', palette.accent],
    ['Background', palette.background],
    ['Text', palette.text],
  ];

  return (
    <ul className="grid grid-cols-5 gap-1.5">
      {entries.map(([label, color]) => (
        <li key={label} className="text-center">
          <span
            className="block h-8 w-full rounded border border-line"
            style={{ backgroundColor: color }}
            title={`${label} ${color}`}
          />
          <span className="mt-1 block text-[10px] uppercase tracking-wide text-ink-muted">
            {label}
          </span>
        </li>
      ))}
    </ul>
  );
}
