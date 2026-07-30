import 'server-only';

import { Vibrant } from 'node-vibrant/node';
import sharp from 'sharp';

import type { Palette } from '@/db/schema';

/**
 * Derives colour palettes from a school's logo.
 *
 * Three candidates are produced so the Super Admin has a real choice rather
 * than one take-it-or-leave-it result:
 *
 *   0. Vibrant  — the boldest colours in the logo. Reads as the brand colour.
 *   1. Muted    — the same image's subdued tones. Calmer, better for dense UI.
 *   2. Auto     — the dominant hue plus its complement, computed rather than
 *                 sampled, for logos that are nearly monochrome and so give
 *                 Vibrant and Muted almost nothing to distinguish.
 *
 * Every palette is checked for text contrast before it is returned, so a pale
 * logo cannot produce unreadable body text.
 */

/** Downscale before quantising — a 150px image is plenty and much faster. */
const ANALYSIS_WIDTH = 150;

/** WCAG AA for normal text. Used to pick between light and dark foregrounds. */
const MIN_CONTRAST_RATIO = 4.5;

const FALLBACK_PALETTE: Palette = {
  primary: '#1d4ed8',
  secondary: '#0f172a',
  accent: '#0ea5e9',
  background: '#f8fafc',
  text: '#0f172a',
};

interface Rgb {
  r: number;
  g: number;
  b: number;
}

// -----------------------------------------------------------------------------
// Colour maths
// -----------------------------------------------------------------------------

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex({ r, g, b }: Rgb): string {
  const hex = (channel: number) =>
    clampChannel(channel).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function fromHex(hex: string): Rgb | null {
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
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/** Relative luminance per WCAG 2.1. */
function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (raw: number): number => {
    const scaled = raw / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  const lightness = (max + min) / 2;

  if (delta === 0) return [0, 0, lightness];

  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue: number;
  if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
  else if (max === green) hue = ((blue - red) / delta + 2) / 6;
  else hue = ((red - green) / delta + 4) / 6;

  return [hue, saturation, lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  if (saturation === 0) {
    const grey = lightness * 255;
    return { r: grey, g: grey, b: grey };
  }

  const hueToChannel = (p: number, q: number, t: number): number => {
    let shifted = t;
    if (shifted < 0) shifted += 1;
    if (shifted > 1) shifted -= 1;
    if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
    if (shifted < 1 / 2) return q;
    if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
    return p;
  };

  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  return {
    r: hueToChannel(p, q, hue + 1 / 3) * 255,
    g: hueToChannel(p, q, hue) * 255,
    b: hueToChannel(p, q, hue - 1 / 3) * 255,
  };
}

/** Picks near-black or near-white, whichever reads better on `background`. */
function readableTextColor(background: Rgb): string {
  const dark = { r: 15, g: 23, b: 42 };
  const light = { r: 248, g: 250, b: 252 };

  const darkContrast = contrastRatio(background, dark);
  if (darkContrast >= MIN_CONTRAST_RATIO) return toHex(dark);

  const lightContrast = contrastRatio(background, light);
  return lightContrast > darkContrast ? toHex(light) : toHex(dark);
}

/** A very light tint of a hue, for page backgrounds. */
function tintedBackground(base: Rgb): string {
  const [hue, saturation] = rgbToHsl(base);
  return toHex(hslToRgb(hue, Math.min(saturation, 0.35), 0.975));
}

// -----------------------------------------------------------------------------
// Palette assembly
// -----------------------------------------------------------------------------

function buildPalette(primary: Rgb, secondary: Rgb, accent: Rgb): Palette {
  const background = tintedBackground(primary);
  const backgroundRgb = fromHex(background) ?? { r: 248, g: 250, b: 252 };

  return {
    primary: toHex(primary),
    secondary: toHex(secondary),
    accent: toHex(accent),
    background,
    text: readableTextColor(backgroundRgb),
  };
}

/** Rotates a hue by 180° to get its complement. */
function complementOf(base: Rgb): Rgb {
  const [hue, saturation, lightness] = rgbToHsl(base);
  return hslToRgb((hue + 0.5) % 1, saturation, lightness);
}

/** Darkens or lightens toward a target lightness, preserving hue. */
function shift(base: Rgb, targetLightness: number): Rgb {
  const [hue, saturation] = rgbToHsl(base);
  return hslToRgb(hue, saturation, targetLightness);
}

/**
 * Extracts three candidate palettes from a logo.
 *
 * Never throws for image reasons: an unreadable or colourless logo falls back
 * to the platform defaults rather than failing the upload, because the Super
 * Admin can always pick colours manually afterwards.
 */
export async function extractPalettes(imageBuffer: Buffer): Promise<Palette[]> {
  let analysed: Buffer;

  try {
    // Flatten onto white first: transparent PNG logos otherwise quantise their
    // alpha region as black and skew every swatch dark.
    analysed = await sharp(imageBuffer)
      .resize(ANALYSIS_WIDTH, ANALYSIS_WIDTH, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png()
      .toBuffer();
  } catch {
    return [FALLBACK_PALETTE, FALLBACK_PALETTE, FALLBACK_PALETTE];
  }

  let swatches: Awaited<ReturnType<Vibrant['getPalette']>>;
  try {
    swatches = await Vibrant.from(analysed).getPalette();
  } catch {
    return [FALLBACK_PALETTE, FALLBACK_PALETTE, FALLBACK_PALETTE];
  }

  const hexOf = (name: string): Rgb | null => {
    const swatch = swatches[name];
    return swatch == null ? null : fromHex(swatch.hex);
  };

  const vibrant = hexOf('Vibrant');
  const darkVibrant = hexOf('DarkVibrant');
  const lightVibrant = hexOf('LightVibrant');
  const muted = hexOf('Muted');
  const darkMuted = hexOf('DarkMuted');
  const lightMuted = hexOf('LightMuted');

  // The strongest colour available, used as the seed for the computed palette.
  const dominant = vibrant ?? muted ?? darkVibrant ?? darkMuted ?? null;

  if (dominant === null) {
    return [FALLBACK_PALETTE, FALLBACK_PALETTE, FALLBACK_PALETTE];
  }

  const vibrantPalette = buildPalette(
    vibrant ?? dominant,
    darkVibrant ?? shift(vibrant ?? dominant, 0.2),
    lightVibrant ?? shift(vibrant ?? dominant, 0.65),
  );

  const mutedPalette = buildPalette(
    muted ?? shift(dominant, 0.45),
    darkMuted ?? shift(dominant, 0.22),
    lightMuted ?? shift(dominant, 0.7),
  );

  const autoPalette = buildPalette(
    dominant,
    shift(dominant, 0.18),
    complementOf(dominant),
  );

  return [vibrantPalette, mutedPalette, autoPalette];
}

export { FALLBACK_PALETTE };
