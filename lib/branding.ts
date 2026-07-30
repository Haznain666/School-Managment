import { eq } from 'drizzle-orm';

import { schoolBranding, type Palette } from '@/db/schema';

import { db } from './drizzle';

/**
 * Per-tenant theming.
 *
 * Tailwind's `brand.*` colours resolve to CSS variables (see
 * `tailwind.config.ts`). A school's selected palette is turned into those
 * variables and applied on the portal shell, so the same components render in
 * each school's colours without any per-tenant CSS build.
 */

export const DEFAULT_PALETTE: Palette = {
  primary: '#1d4ed8',
  secondary: '#0f172a',
  accent: '#0ea5e9',
  background: '#f8fafc',
  text: '#0f172a',
};

/** `#1d4ed8` -> `29 78 216`, the space-separated form Tailwind's alpha syntax needs. */
function hexToRgbChannels(hex: string): string | null {
  const cleaned = hex.trim().replace(/^#/, '');

  const expanded =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((char) => char + char)
          .join('')
      : cleaned;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;

  const value = Number.parseInt(expanded, 16);
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;

  return `${red} ${green} ${blue}`;
}

const VARIABLE_NAMES: ReadonlyArray<[keyof Palette, string]> = [
  ['primary', '--brand-primary'],
  ['secondary', '--brand-secondary'],
  ['accent', '--brand-accent'],
  ['background', '--brand-background'],
  ['text', '--brand-text'],
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
      hexToRgbChannels(effective[key]) ?? hexToRgbChannels(DEFAULT_PALETTE[key]);
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
    .set({ selectedPalette: paletteIndex, updatedAt: new Date() })
    .where(eq(schoolBranding.locationId, locationId));

  return chosen;
}

export type { Palette };
