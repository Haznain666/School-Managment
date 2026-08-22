import { parseHex, readableForeground } from './color-contrast';

/**
 * Performance descriptors: validating one, canonicalising its colour, and
 * deciding how it is painted.
 *
 * Deliberately dependency-free of the database and of `server-only`, for the
 * same reason `lib/grading.ts` is: the settings editor previews a chip in the
 * browser and the report card renders the same chip on the server, and two
 * implementations of "what does Exceeding look like" is one too many. The
 * arithmetic behind the foreground colour is `lib/color-contrast.ts`, which
 * already existed for exactly this and is dependency-free too.
 */

/** What a result sheet prints where no descriptor was recorded. */
export const SUBCATEGORY_EMPTY = '—';

/** The longest label the database will accept. */
export const SUBCATEGORY_LABEL_MAX = 40;

/** A descriptor as anything that renders one needs it. */
export interface SubcategoryLike {
  id: string;
  label: string;
  colorHex: string | null;
}

/**
 * `#22C55E`, `22c55e` and `rgb(34, 197, 94)` all become `#22C55E`.
 *
 * Three input shapes because three things produce colours: a native colour
 * input (`#rrggbb`), somebody pasting a hex out of a brand guide without the
 * hash, and somebody pasting out of a design tool that copies `rgb(...)`.
 * Refusing the last two would be refusing the school's own colour on a
 * technicality it cannot see.
 *
 * Returns null for anything else, including blank — a sub-category with no
 * colour is a valid sub-category, not an error.
 */
export function normalizeHex(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,[^)]*)?\)$/i.exec(
    trimmed,
  );
  if (rgb !== null) {
    const channels = [rgb[1], rgb[2], rgb[3]].map((part) => Number(part));
    if (channels.some((channel) => !Number.isInteger(channel) || channel > 255)) {
      return null;
    }
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }

  const parsed = parseHex(trimmed);
  if (parsed === null) return null;

  return `#${[parsed.r, parsed.g, parsed.b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

/**
 * What is wrong with a sub-category, or null when it is usable.
 *
 * `existingLabels` is every *other* unarchived label at the school, already
 * lower-cased and trimmed by the caller — the same canonicalisation the partial
 * unique index applies. Checking it here means the clerk gets a sentence rather
 * than a constraint violation, and the index is the backstop.
 */
export function subcategoryProblem(
  label: string,
  colorHex: string | null,
  existingLabels: readonly string[],
): string | null {
  const trimmed = label.trim();

  if (trimmed === '') return 'Give the sub-category a label.';
  if (trimmed.length > SUBCATEGORY_LABEL_MAX) {
    return `A label is ${SUBCATEGORY_LABEL_MAX} characters or fewer.`;
  }

  if (existingLabels.includes(trimmed.toLowerCase())) {
    return `There is already a sub-category called "${trimmed}".`;
  }

  // Blank is allowed; unreadable is not. A colour that reached the column and
  // failed the CHECK would surface as a 500 on a screen with a colour picker
  // on it, which reads as the picker being broken.
  if (colorHex !== null && colorHex !== '' && normalizeHex(colorHex) === null) {
    return 'That is not a colour. Use a hex value like #22C55E.';
  }

  return null;
}

/** The inline style a chip carries. Empty when it is not to be painted. */
export interface SubcategoryStyle {
  backgroundColor?: string;
  color?: string;
}

/**
 * The style for one descriptor, honouring the school's colour-coding switch.
 *
 * Returns `{}` — not a grey fallback — when colour coding is off or the school
 * chose no colour. An empty style object is what makes
 * `components/exams/SubcategoryBadge.tsx` render the plain label with no chip
 * around it, which is the specified behaviour: colour off means *no styling*,
 * not a colourless version of the same pill.
 *
 * The foreground is computed, never chosen. A school that picks `#F59E0B` and
 * gets white lettering on it has an unreadable report card, and it would be
 * unreadable on every card it ever prints. `readableForeground` picks the
 * better of near-black and near-white by WCAG luminance.
 */
export function subcategoryStyle(
  subcategory: Pick<SubcategoryLike, 'colorHex'> | null,
  colorCodingEnabled: boolean,
): SubcategoryStyle {
  if (!colorCodingEnabled || subcategory === null) return {};

  const hex = normalizeHex(subcategory.colorHex);
  if (hex === null) return {};

  return { backgroundColor: hex, color: readableForeground(hex) };
}
