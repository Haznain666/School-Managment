/**
 * Colour maths shared by palette extraction and palette application.
 *
 * This module exists because the two halves of theming used to compute
 * contrast independently — `lib/color-extraction.ts` checked it when *deriving*
 * a palette from a logo, and nothing checked it when *painting* with one. So a
 * palette could be produced with legible body text and then have white lettering
 * put on a pale primary by a hardcoded `text-white`, which is how a yellow
 * school crest ends up with invisible buttons.
 *
 * `color-extraction.ts` is `server-only` and pulls in sharp and node-vibrant.
 * This one is deliberately dependency-free so `lib/branding.ts` — which runs in
 * every portal layout on every request — can use the same arithmetic rather
 * than a second copy of it.
 *
 * WCAG 2.1 relative luminance throughout.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** WCAG AA for normal text. */
export const MIN_CONTRAST_RATIO = 4.5;

/** Near-black and near-white, the only two foregrounds this application picks. */
export const DARK_FOREGROUND = '#0f172a';
export const LIGHT_FOREGROUND = '#f8fafc';

/** Parses `#abc` or `#aabbcc`. Null for anything else. */
export function parseHex(hex: string): Rgb | null {
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
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (raw: number): number => {
    const scaled = raw / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Near-black or near-white, whichever reads better on `background`.
 *
 * Neither is guaranteed to clear 4.5:1 — a mid-grey surface clears it against
 * nothing — so this returns the better of the two rather than failing. A school
 * that picks a colour like that gets the most legible option available, which
 * is the most this can honestly promise.
 */
export function readableForeground(background: string): string {
  const parsed = parseHex(background);
  if (parsed === null) return DARK_FOREGROUND;

  const dark = parseHex(DARK_FOREGROUND)!;
  const light = parseHex(LIGHT_FOREGROUND)!;

  const darkContrast = contrastRatio(parsed, dark);
  if (darkContrast >= MIN_CONTRAST_RATIO) return DARK_FOREGROUND;

  return contrastRatio(parsed, light) > darkContrast ? LIGHT_FOREGROUND : DARK_FOREGROUND;
}

/** `#1d4ed8` -> `29 78 216`, the form Tailwind's `/ <alpha-value>` needs. */
export function toRgbChannels(hex: string): string | null {
  const parsed = parseHex(hex);
  return parsed === null ? null : `${parsed.r} ${parsed.g} ${parsed.b}`;
}
