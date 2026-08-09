import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { PALETTE_PRESETS } from '@/lib/palette-presets';

import { schools } from './schools';

/**
 * A school's colour scheme. Derived from their logo by
 * `lib/color-extraction.ts`, then applied to their portal as CSS variables.
 */
export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

/**
 * school_branding — logo and colour palettes, one row per school.
 *
 * Three candidate palettes are generated on upload (Vibrant, Muted and an
 * auto-complementary variant); `selected_palette` indexes which one is live.
 * All three are kept so a Super Admin can switch without re-uploading.
 */
export const schoolBranding = pgTable(
  'school_branding',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .unique()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** Publicly readable download URL — the login page shows it before auth. */
    logoUrl: text('logo_url'),
    /** Object path inside the Storage bucket, for replacement and deletion. */
    logoStoragePath: text('logo_storage_path'),
    /** Index into palette_0 / palette_1 / palette_2. */
    selectedPalette: integer('selected_palette').notNull().default(0),
    /**
     * A curated preset from `lib/palette-presets.ts`, when the school has
     * chosen one instead of a palette derived from its logo.
     *
     * Null means "use the derived palette at `selected_palette`", which is the
     * behaviour every existing row already has — so this column defaults to
     * null and nothing needed back-filling.
     *
     * The *key* is stored rather than the colours, so improving a preset
     * re-themes every school on it. The cost of that choice is that renaming a
     * key silently drops those schools back to their derived palette; the
     * presets module carries the warning.
     */
    presetKey: text('preset_key'),
    palette0: jsonb('palette_0').$type<Palette>(),
    palette1: jsonb('palette_1').$type<Palette>(),
    palette2: jsonb('palette_2').$type<Palette>(),
    /** Manual CSS variable overrides, applied on top of the chosen palette. */
    customCssVars: jsonb('custom_css_vars').$type<Record<string, string>>(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('school_branding_location_id_idx').on(table.locationId)],
);

export type SchoolBrandingRow = typeof schoolBranding.$inferSelect;
export type NewSchoolBrandingRow = typeof schoolBranding.$inferInsert;

/**
 * Reads the live palette out of a branding row, or null if none is stored.
 *
 * A chosen preset outranks the derived palettes. This is the single choke
 * point every consumer already reads through — the portal shell, the login
 * page, the invite page and both branding APIs — so presets reach all of them
 * without a change at any call site.
 *
 * `lib/palette-presets.ts` imports the `Palette` *type* from this file and
 * nothing else, and a type import is erased at compile time — so importing the
 * preset values back the other way is not a runtime cycle.
 */
export function selectedPaletteOf(row: SchoolBrandingRow): Palette | null {
  if (row.presetKey != null && row.presetKey !== '') {
    const preset = PALETTE_PRESETS.find((entry) => entry.key === row.presetKey);
    if (preset !== undefined) return preset.palette;
    // An unknown key means a preset was removed from the code. Falling through
    // to the derived palette is the honest answer — better a school's own
    // colours than a hard failure on every page it themes.
  }

  const palettes = [row.palette0, row.palette1, row.palette2];
  return palettes[row.selectedPalette] ?? null;
}
