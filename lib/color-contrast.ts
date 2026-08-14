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

/* -----------------------------------------------------------------------------
 * HSL, for deriving one colour from another.
 *
 * Sprint 10.5 needs more than the five stored colours: card surfaces, borders,
 * hover fills, muted text and four status colours all have to come from the
 * school's palette rather than from a hardcoded slate ramp. Every one of those
 * is "this colour, lighter" or "this colour, rotated" — which is HSL arithmetic,
 * so it lives here beside the contrast maths the derivations are checked with.
 *
 * HSL and not OKLCH deliberately: these values are written into CSS variables as
 * RGB channels for Tailwind's `/ <alpha-value>` syntax, so the space is an
 * implementation detail that never reaches the stylesheet, and HSL costs no
 * dependency. Perceptual uniformity would matter if these ramps were read as a
 * sequence; they are read as single functional colours, each independently
 * contrast-checked below.
 * -------------------------------------------------------------------------- */

export interface Hsl {
  /** Degrees, 0–360. */
  h: number;
  /** 0–1. */
  s: number;
  /** 0–1. */
  l: number;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));

  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;

  h *= 60;
  if (h < 0) h += 360;

  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;

  const [r1, g1, b1] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The shorter way round the hue wheel from `from` to `to`, signed.
 * `hueDelta(350, 10)` is `20`, not `-340`.
 */
export function hueDelta(from: number, to: number): number {
  const raw = (((to - from) % 360) + 360) % 360;
  return raw > 180 ? raw - 360 : raw;
}

/** Absolute separation between two hues, 0–180. */
export function hueDistance(a: number, b: number): number {
  return Math.abs(hueDelta(a, b));
}

/**
 * Moves `colour` toward `target` by `amount` (0 = unchanged, 1 = target).
 * Straight RGB interpolation, which is what "tint this toward the page
 * background" means and is stable for the small steps used here.
 */
export function mix(colour: Rgb, target: Rgb, amount: number): Rgb {
  const t = clamp01(amount);
  return {
    r: Math.round(colour.r + (target.r - colour.r) * t),
    g: Math.round(colour.g + (target.g - colour.g) * t),
    b: Math.round(colour.b + (target.b - colour.b) * t),
  };
}

/** True when `colour` is dark enough that a light foreground reads better. */
export function isDark(colour: Rgb): boolean {
  return relativeLuminance(colour) < 0.35;
}

/**
 * Walks `colour`'s lightness until it clears `ratio` against `against`,
 * moving in whichever direction the background makes available.
 *
 * Returns the closest passing colour, or the best attempt when the target is
 * unreachable — the same honest-failure contract as `readableForeground`, and
 * for the same reason: refusing would leave a school with no colour at all.
 */
export function ensureContrast(colour: Rgb, against: Rgb, ratio: number): Rgb {
  if (contrastRatio(colour, against) >= ratio) return colour;

  const hsl = rgbToHsl(colour);
  // Darken when the surface is light, lighten when it is dark.
  const direction = isDark(against) ? 1 : -1;

  let best = colour;
  let bestRatio = contrastRatio(colour, against);

  for (let step = 1; step <= 100; step += 1) {
    const candidate = hslToRgb({
      ...hsl,
      l: clamp01(hsl.l + direction * step * 0.01),
    });
    const candidateRatio = contrastRatio(candidate, against);

    if (candidateRatio > bestRatio) {
      best = candidate;
      bestRatio = candidateRatio;
    }
    if (candidateRatio >= ratio) return candidate;
  }

  return best;
}
