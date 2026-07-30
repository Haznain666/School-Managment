import type { SchoolColorPalette } from '@/db/schema';

/**
 * Per-tenant theming.
 *
 * Tailwind's `brand.*` colours resolve to CSS variables (see
 * `tailwind.config.ts`). A school's `color_palette` is turned into those
 * variables and applied on the portal shell, so the same components render in
 * each school's colours without any per-tenant CSS build.
 */

export const DEFAULT_PALETTE: SchoolColorPalette = {
  primary: '#1d4ed8',
  secondary: '#0f172a',
  accent: '#0ea5e9',
  surface: '#f8fafc',
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

/**
 * Builds the inline style object that carries a school's palette.
 * Invalid or missing colours silently fall back to the platform default, so a
 * malformed palette can never break the layout.
 */
export function paletteToCssVariables(
  palette: SchoolColorPalette | null,
): Record<string, string> {
  const effective: SchoolColorPalette = { ...DEFAULT_PALETTE, ...(palette ?? {}) };

  const variables: Record<string, string> = {};
  const entries: ReadonlyArray<[keyof SchoolColorPalette, string]> = [
    ['primary', '--brand-primary'],
    ['secondary', '--brand-secondary'],
    ['accent', '--brand-accent'],
    ['surface', '--brand-surface'],
    ['text', '--brand-text'],
  ];

  for (const [key, variableName] of entries) {
    const channels =
      hexToRgbChannels(effective[key]) ?? hexToRgbChannels(DEFAULT_PALETTE[key]);
    if (channels !== null) variables[variableName] = channels;
  }

  return variables;
}
