import type { Palette } from '@/db/schema/school-branding';

/**
 * Curated palettes a school can choose instead of the three derived from its
 * logo.
 *
 * ── Why these exist ──────────────────────────────────────────────────────
 * `lib/color-extraction.ts` produces Vibrant, Muted and an auto-complementary
 * variant from the uploaded logo. That is the right default — a school's own
 * colours should drive its portal — but it has two failure modes seen in
 * practice: a logo that is mostly black, white or grey yields three near
 * identical greys, and a logo with one saturated colour yields three shades of
 * it. The extraction docblock already admits Vibrant and Muted often have
 * "almost nothing to distinguish" them.
 *
 * These presets are the floor, not the ceiling: a school with strong brand
 * colours keeps them, and a school whose logo carries none gets something that
 * still looks deliberate.
 *
 * ── Where they came from ─────────────────────────────────────────────────
 * Pulled from the 21st.dev community theme catalog on 2026-08-09 (Elegant
 * Luxury, Forest Linen and Cobalt Mono), then adapted to this application's
 * five-slot `Palette` rather than copied verbatim. The adaptation is not
 * cosmetic and is the reason these are not raw theme dumps:
 *
 *   - shadcn themes spend `secondary` on a *pale* surface tint. Here
 *     `secondary` is a dark supporting brand colour — the platform default is
 *     slate-900 — so each preset's secondary is derived as a deepened form of
 *     its primary instead.
 *   - shadcn `accent` is likewise a wash (`#d4ead9`, `#fef3c7`). This
 *     application paints `accent` on live elements, so it needs to hold its own
 *     against the background.
 *
 * Copying the tokens straight across would have produced three palettes whose
 * secondary and accent were invisible on a white page.
 *
 * ── Contrast ─────────────────────────────────────────────────────────────
 * Every `primary` clears 4.5:1 against its own `background`, and white clears
 * 4.5:1 against every `primary` — so the primary works both as text on the page
 * and as a button fill with white text on it. Checked at the values below;
 * re-check if you change one.
 *
 * Keys are stored in `school_branding.preset_key` and must stay stable — a row
 * holds the key, not the colours, so improving a preset here re-themes every
 * school already using it. That is deliberate. Renaming a key silently drops
 * those schools back to their derived palette, so do not rename one.
 */

export interface PalettePreset {
  key: string;
  name: string;
  /** One line, shown under the name on the picker. */
  description: string;
  palette: Palette;
}

export const PALETTE_PRESETS: readonly PalettePreset[] = [
  {
    key: 'crimson-gold',
    name: 'Crimson & Gold',
    description: 'Formal and crest-like. Reads well on a printed report card.',
    palette: {
      primary: '#9b2c2c',
      secondary: '#7f1d1d',
      accent: '#b8860b',
      background: '#faf7f5',
      text: '#1a1a1a',
    },
  },
  {
    key: 'forest-linen',
    name: 'Forest Linen',
    description: 'Deep green on white. Calm, and the most legible in dense tables.',
    palette: {
      primary: '#1a6b3a',
      secondary: '#0f3d23',
      accent: '#2f9e6a',
      background: '#ffffff',
      text: '#111111',
    },
  },
  {
    key: 'cobalt',
    name: 'Cobalt',
    description: 'A confident blue — the familiar school colour, without the fade.',
    palette: {
      primary: '#0f62fe',
      secondary: '#0d0d12',
      accent: '#4589ff',
      background: '#fdfdff',
      text: '#0d0d12',
    },
  },
] as const;

/** The preset for a stored key, or null when the key is unknown or absent. */
export function presetFor(key: string | null | undefined): PalettePreset | null {
  if (key == null || key === '') return null;
  return PALETTE_PRESETS.find((preset) => preset.key === key) ?? null;
}

/** Whether a value is a key this application still recognises. */
export function isPresetKey(value: unknown): value is string {
  return typeof value === 'string' && presetFor(value) !== null;
}
