import { eq } from 'drizzle-orm';

import { schoolBranding, type Palette } from '@/db/schema';

import { readableForeground, toRgbChannels } from './color-contrast';
import { db } from './drizzle';
import { presetFor } from './palette-presets';

/**
 * Per-tenant theming.
 *
 * Tailwind's `brand.*` colours resolve to CSS variables (see
 * `tailwind.config.ts`). A school's selected palette is turned into those
 * variables and applied on the portal shell, so the same components render in
 * each school's colours without any per-tenant CSS build.
 *
 * ── Five colours are stored; five colours are now used ───────────────────
 * Until 2026-08-09 only `--brand-primary` was ever consumed. The other four
 * were extracted from the logo, offered as three candidate palettes, drawn as
 * swatches, rendered in a portal mock-up by `PalettePreview`, stored, selected —
 * and then nothing read them. A school picked a five-colour template and got
 * one colour, which is exactly what "the selected template is not fully
 * applied" describes.
 *
 * The preview is the specification, and the shells were brought up to it:
 * `background` paints the page, `secondary` the sidebar, `primary` the header,
 * `text` the body copy, `accent` the active marker.
 *
 * ── The three variables that are not stored ──────────────────────────────
 * `--brand-on-primary`, `--brand-on-secondary` and `--brand-on-accent` are
 * *computed* here, per palette, by the same WCAG arithmetic that decided the
 * palette's own `text`. Painting a surface in a school's colour means something
 * has to be legible on top of it, and the shells previously hardcoded
 * `text-white` — fine for the navy default and for all three presets, wrong for
 * a school whose logo is yellow. They are derived rather than stored so that
 * schools themed before this change get them too, without a migration.
 */

export const DEFAULT_PALETTE: Palette = {
  primary: '#1d4ed8',
  secondary: '#0f172a',
  accent: '#0ea5e9',
  background: '#f8fafc',
  text: '#0f172a',
};

const VARIABLE_NAMES: ReadonlyArray<[keyof Palette, string]> = [
  ['primary', '--brand-primary'],
  ['secondary', '--brand-secondary'],
  ['accent', '--brand-accent'],
  ['background', '--brand-background'],
  ['text', '--brand-text'],
];

/** Surfaces that get painted in a brand colour, and so need a foreground. */
const FOREGROUND_NAMES: ReadonlyArray<[keyof Palette, string]> = [
  ['primary', '--brand-on-primary'],
  ['secondary', '--brand-on-secondary'],
  ['accent', '--brand-on-accent'],
];

/**
 * Builds the inline style object that carries a school's palette.
 * Invalid or missing colours silently fall back to the platform default, so a
 * malformed palette can never break the layout.
 */
export function paletteToCSSVars(palette: Palette | null): Record<string, string> {
  const effective: Palette = { ...DEFAULT_PALETTE, ...(palette ?? {}) };

  const variables: Record<string, string> = {};

  for (const [key, variableName] of VARIABLE_NAMES) {
    const channels =
      toRgbChannels(effective[key]) ?? toRgbChannels(DEFAULT_PALETTE[key]);
    if (channels !== null) variables[variableName] = channels;
  }

  for (const [key, variableName] of FOREGROUND_NAMES) {
    // Resolved against the colour that will actually be painted, which may be
    // the platform default if the school's own value did not parse.
    const surface =
      toRgbChannels(effective[key]) === null ? DEFAULT_PALETTE[key] : effective[key];
    const channels = toRgbChannels(readableForeground(surface));
    if (channels !== null) variables[variableName] = channels;
  }

  return variables;
}

/** Sprint 1 name, kept so existing call sites do not need to change. */
export const paletteToCssVariables = paletteToCSSVars;

/**
 * Switches a school to one of its three stored palettes.
 *
 * Returns the palette that is now live, or null when the school has no
 * branding row or the index has no palette stored against it.
 *
 * Always clears `presetKey`: a preset outranks the derived palettes, so
 * leaving one set would make this call appear to do nothing. The two are one
 * setting with two sources, not two switches.
 */
export async function applyBrandingToSchool(
  locationId: string,
  paletteIndex: number,
): Promise<Palette | null> {
  if (paletteIndex < 0 || paletteIndex > 2) return null;

  const rows = await db
    .select()
    .from(schoolBranding)
    .where(eq(schoolBranding.locationId, locationId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const palettes = [row.palette0, row.palette1, row.palette2];
  const chosen = palettes[paletteIndex];
  if (chosen == null) return null;

  await db
    .update(schoolBranding)
    .set({ selectedPalette: paletteIndex, presetKey: null, updatedAt: new Date() })
    .where(eq(schoolBranding.locationId, locationId));

  return chosen;
}

/**
 * Switches a school to one of the curated presets.
 *
 * Unlike `applyBrandingToSchool`, this **creates the branding row if there is
 * none**. A preset is the one branding choice that does not depend on a logo,
 * and a school that has not uploaded one is exactly the school most likely to
 * want it — refusing here would make the feature unavailable precisely when it
 * is most useful.
 */
export async function applyPresetToSchool(
  locationId: string,
  presetKey: string,
): Promise<Palette | null> {
  const preset = presetFor(presetKey);
  if (preset === null) return null;

  await db
    .insert(schoolBranding)
    .values({ locationId, presetKey, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schoolBranding.locationId,
      set: { presetKey, updatedAt: new Date() },
    });

  return preset.palette;
}

export type { Palette };
