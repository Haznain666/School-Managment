'use client';

import { useId, useMemo, useState } from 'react';

import { SUBJECT_COLORS, isHexColor } from '@/db/schema/subjects';
import {
  MIN_CONTRAST_RATIO,
  contrastRatio,
  parseHex,
  readableForeground,
} from '@/lib/color-contrast';

/**
 * Choosing a subject's colour: the eight presets, and any colour at all.
 *
 * ── Why the palette stayed ───────────────────────────────────────────────
 * The eight are not decoration and they are not a limitation the school has
 * outgrown. They are chosen to stay apart from one another in a grid of
 * thirty-five cells, which is the property a timetable actually needs and the
 * one a free picker cannot promise. So they stay, first, one click, and they
 * remain what a school that does not care gets.
 *
 * ── Why a free picker was still right ────────────────────────────────────
 * A school with a house colour, a printed prospectus, or eleven subjects has a
 * reason the palette cannot serve, and "these eight or nothing" is a rule the
 * product has no standing to make. The API already accepted any `#rrggbb`; only
 * the form was closed.
 *
 * ── What the picker does that a bare `<input type="color">` does not ──────
 * Three things, and each of them is a defect this codebase has already had:
 *
 *   1. **It shows the cell, not the swatch.** The preview is a real timetable
 *      cell with real lettering, because a colour looks different at 36px round
 *      than it does behind two lines of 11px text.
 *
 *   2. **It computes the lettering and says so.** `readableForeground` is what
 *      the grid uses, so the preview cannot flatter a colour the grid will
 *      render differently. §5p records the same class of bug one level up, in
 *      the branding palette.
 *
 *   3. **It warns when the contrast is genuinely poor.** A warning, not a
 *      refusal — a pale yellow that fails against both black and white is a
 *      legitimate thing for a school to want, and the school is the one looking
 *      at its own timetable. Refusing it would be this product overruling a
 *      customer about their own house colour. Telling them is not.
 *
 * A near-duplicate of another subject's colour is warned about for the same
 * reason and with the same lack of teeth. The list of colours already in use is
 * passed in; nothing is fetched here.
 */

export interface SubjectColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
  /** Colours other subjects already use, for the "too close" warning. */
  inUse?: ReadonlyArray<{ name: string; color: string | null }>;
  /** Shown in the preview cell so it reads as the real thing. */
  previewLabel: string;
}

/** How far apart two colours must be before they read as one in a grid. */
const MIN_DISTANCE = 60;

/**
 * Plain Euclidean distance in RGB.
 *
 * Not perceptually uniform, and deliberately not: this is a warning threshold,
 * not a measurement, and a school that ignores it loses nothing. Reaching for
 * CIEDE2000 here would add a dependency to make a heuristic slightly less
 * rough.
 */
function distance(a: string, b: string): number {
  const left = parseHex(a);
  const right = parseHex(b);
  if (left === null || right === null) return Number.POSITIVE_INFINITY;

  return Math.sqrt(
    (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2,
  );
}

function bestContrast(color: string): number {
  const rgb = parseHex(color);
  if (rgb === null) return 0;

  const foreground = parseHex(readableForeground(color));
  if (foreground === null) return 0;

  return contrastRatio(rgb, foreground);
}

export function SubjectColorPicker({
  value,
  onChange,
  disabled = false,
  inUse = [],
  previewLabel,
}: SubjectColorPickerProps) {
  const inputId = useId();

  // The hex box is its own state so a half-typed "#2f" does not repeatedly
  // reject itself while somebody is still typing the rest of it.
  const [typed, setTyped] = useState(value);

  const isPreset = (SUBJECT_COLORS as readonly string[]).includes(value);

  const contrast = useMemo(() => bestContrast(value), [value]);

  const clash = useMemo(() => {
    for (const subject of inUse) {
      if (subject.color === null) continue;
      if (subject.color.toLowerCase() === value.toLowerCase()) return subject.name;
      if (distance(subject.color, value) < MIN_DISTANCE) return subject.name;
    }
    return null;
  }, [inUse, value]);

  const commit = (next: string): void => {
    const normalised = next.trim().toLowerCase();
    setTyped(normalised);
    if (isHexColor(normalised)) onChange(normalised);
  };

  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-1.5 block text-sm font-medium text-ink">Colour</legend>

      <div className="flex flex-wrap items-start gap-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
            Palette
          </p>

          <div className="flex flex-wrap gap-2">
            {SUBJECT_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`Use colour ${option}`}
                aria-pressed={value === option}
                disabled={disabled}
                onClick={() => {
                  setTyped(option);
                  onChange(option);
                }}
                className={
                  value === option
                    ? 'h-9 w-9 rounded-full ring-2 ring-ink ring-offset-2'
                    : 'h-9 w-9 rounded-full ring-1 ring-line-strong'
                }
                style={{ backgroundColor: option }}
              />
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor={inputId}
            className="mb-2 block text-xs font-medium uppercase tracking-wide text-ink-muted"
          >
            Or pick your own
          </label>

          <div className="flex items-center gap-2">
            {/*
              The native picker is the whole point of the feature: it is the
              operating system's colour wheel, it is keyboard accessible, and
              re-implementing an HSV square in a canvas would be a worse one.
              The hex box beside it is what makes a brand colour paste-able,
              which the wheel alone never is.
            */}
            <input
              id={inputId}
              type="color"
              value={isHexColor(value) ? value : '#2563eb'}
              disabled={disabled}
              onChange={(event) => {
                commit(event.target.value);
              }}
              aria-label="Custom colour"
              className="h-9 w-12 cursor-pointer rounded-lg border border-line-strong bg-surface p-0.5 disabled:cursor-not-allowed"
            />

            <input
              type="text"
              value={typed}
              maxLength={7}
              spellCheck={false}
              placeholder="#2563eb"
              disabled={disabled}
              aria-label="Colour hex code"
              aria-invalid={!isHexColor(typed)}
              onChange={(event) => {
                commit(event.target.value);
              }}
              onBlur={() => {
                // A hex that never became valid reverts rather than sitting
                // there looking saved. The colour behind it never changed.
                if (!isHexColor(typed)) setTyped(value);
              }}
              className="h-9 w-28 rounded-lg border border-line-strong bg-surface px-2 font-mono text-sm text-ink disabled:cursor-not-allowed"
            />

            {isPreset ? null : (
              <span className="text-xs text-ink-muted">Custom</span>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
            In the grid
          </p>

          {/* The real cell, at the real size, with the computed lettering. */}
          <div
            className="flex h-[4.5rem] w-40 flex-col justify-center gap-0.5 rounded-lg px-2 py-1.5"
            style={{
              backgroundColor: isHexColor(value) ? value : '#475569',
              color: readableForeground(isHexColor(value) ? value : '#475569'),
            }}
          >
            <span className="truncate text-xs font-semibold">
              {previewLabel === '' ? 'SUBJECT' : previewLabel}
            </span>
            <span className="truncate text-[11px] opacity-90">Teacher name</span>
            <span className="truncate text-[11px] opacity-75">Room 12</span>
          </div>
        </div>
      </div>

      <p className="mt-2 text-sm text-ink-muted">
        How this subject appears in the weekly grid.
      </p>

      {contrast > 0 && contrast < MIN_CONTRAST_RATIO ? (
        <p className="mt-2 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
          The subject code will be hard to read on this colour (contrast{' '}
          {contrast.toFixed(1)}:1, against a target of {MIN_CONTRAST_RATIO}:1). You
          can still use it — a darker or lighter shade of the same hue will read
          better on a phone.
        </p>
      ) : null}

      {clash === null ? null : (
        <p className="mt-2 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
          This is very close to the colour used for {clash}. Two subjects a shade
          apart are hard to tell apart in a full week&rsquo;s grid.
        </p>
      )}
    </fieldset>
  );
}
