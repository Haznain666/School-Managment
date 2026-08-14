import {
  clamp01,
  contrastRatio,
  ensureContrast,
  hslToRgb,
  hueDelta,
  hueDistance,
  isDark,
  mix,
  parseHex,
  readableForeground,
  rgbToHsl,
  type Rgb,
} from './color-contrast';

import type { Palette } from '@/db/schema/school-branding';

/**
 * Everything the interface is painted with, derived from the five colours a
 * school actually chose.
 *
 * ── Why this module exists ───────────────────────────────────────────────
 * Until Sprint 10.5 the palette reached the shell and stopped. `PortalSidebar`
 * and the page header consumed `secondary`, `primary` and `accent`; everything
 * below them — cards, tables, borders, muted labels, every badge — was
 * hardcoded `slate-*`, `white` and `red-600`. A school picked maroon and got a
 * maroon frame around a slate-grey CRM. §5p is the same bug one level up: a
 * five-colour template that reached one colour.
 *
 * Five stored colours cannot paint an application on their own. A CRM needs a
 * raised surface for cards, a sunken one for table headers, a border, a hover
 * fill, a muted ink for secondary text, a focus ring and four status colours —
 * about thirty values. This module computes all of them from the five, so the
 * school's choice reaches the bottom of the interface instead of the top inch
 * of it.
 *
 * ── The rule every derivation obeys ──────────────────────────────────────
 * A derived colour is only worth having if it is legible on the surface it will
 * sit on. Every text-bearing token here is passed through `ensureContrast`
 * against its own background before it is emitted. That is what stops a pale
 * gold school from getting the elegant-looking light-grey body text that is the
 * single most common way a themed interface becomes unreadable.
 *
 * Nothing here is stored. It is recomputed per request from the palette, which
 * means a school themed before this sprint gets all of it without a migration —
 * the same reason the three `on*` foregrounds were computed rather than stored.
 */

/* -----------------------------------------------------------------------------
 * Contrast floors.
 * -------------------------------------------------------------------------- */

/** WCAG AA for normal text. Every token used for text must clear this. */
const TEXT_CONTRAST = 4.5;

/**
 * WCAG AA for large text and UI components. Used for the focus ring and for
 * `--ink-faint`, which is why `--ink-faint` must never carry body copy.
 */
const UI_CONTRAST = 3;

/**
 * The floor for a decorative separator — a card edge, a table rule.
 *
 * Not a WCAG figure. It is the point below which a card on a same-coloured page
 * stops having an edge, which is the failure this guards against; holding a
 * hairline rule to the full 3:1 would draw a grid heavy enough to read as a
 * spreadsheet.
 */
const BORDER_CONTRAST = 1.35;

/* -----------------------------------------------------------------------------
 * Status colours — fully brand-derived, per the user's decision (2026-08-13).
 *
 * The instruction was that the colours a school picks are the colours of the
 * CRM, statuses included. The obvious implementation — recolour every status to
 * the brand — collapses the four into one and destroys the distinction a fee
 * clerk reads at a counter, so it is not what "derived" is taken to mean here.
 *
 * Instead each status starts at its conventional hue and is *rotated toward the
 * school's primary* by as much as it can be while the four remain mutually
 * distinguishable, then takes the brand's saturation character and whatever
 * lightness its legibility on the school's own background requires. A cobalt
 * school gets cool, blue-leaning statuses; a crimson school gets warm ones. The
 * palette moves them; it cannot merge them.
 *
 * The blend is found by search rather than fixed, because how far the four can
 * travel depends on where the brand hue sits relative to them. Red and amber
 * start 36° apart, so any palette between them permits very little rotation —
 * which is the honest answer, not a limitation to engineer around.
 * -------------------------------------------------------------------------- */

/**
 * For each status: its conventional hue, a lightness offset, and the band it
 * may not leave.
 *
 * ── The offsets ──────────────────────────────────────────────────────────
 * Danger and warning start only 39° apart, the narrowest gap in the set and the
 * one most likely to close. Separating them by value as well as by hue is what
 * conventional palettes do — an amber warning is not merely a different hue
 * from a red danger, it is a lighter one — and it is also what keeps the pair
 * apart when a report card is printed in greyscale, where hue carries nothing.
 *
 * ── The bands, and the bug that produced them ────────────────────────────
 * Rotation alone, even with the distinctness search below satisfied, produced
 * this for the platform default (a blue, hue 224): danger rotated to a magenta
 * and warning rotated to `205 51 35`, a red. Both remained perfectly legible
 * and comfortably far apart, so every contrast and distinctness check passed —
 * and the result was an interface where the warning colour looked more alarming
 * than the danger colour. The audit could not see it because it is not a
 * contrast failure; it is a meaning failure.
 *
 * A band is the fix. Each status may lean toward the school's colour as far as
 * it likes *within the range where it still means what it means*: danger stays
 * somewhere in the reds, warning somewhere in the oranges and ambers, success
 * in the greens, info in the blues. Expressed relative to the anchor's own
 * continuous frame rather than as 0–360, so danger's band can cross zero
 * without special-casing.
 *
 * This is the whole of what "fully brand-derived" is taken to mean here: the
 * school's palette chooses where in each band the colour sits, and a crimson
 * school and a cobalt school get visibly different status colours. It does not
 * get to make "paid" and "overdue" swap appearances.
 */
const STATUS_ANCHORS = {
  danger: { hue: 2, lightness: -0.02, band: [-16, 20] },
  warning: { hue: 41, lightness: 0.05, band: [30, 54] },
  success: { hue: 148, lightness: -0.01, band: [124, 168] },
  info: { hue: 211, lightness: 0.02, band: [192, 232] },
} as const;

export type StatusName = keyof typeof STATUS_ANCHORS;

const STATUS_NAMES = Object.keys(STATUS_ANCHORS) as readonly StatusName[];

/** Ceiling on how far a status may be rotated toward the brand hue. */
const MAX_BLEND = 0.35;

/**
 * Minimum hue separation the four must keep. A cheap first gate — see
 * `resolveBlend` for the one that actually decides.
 */
const MIN_SEPARATION = 30;

/**
 * Minimum summed-RGB distance between any two finished status fills.
 *
 * Calibrated against Tailwind's `red-700`/`amber-700`, which are 79 apart by
 * this measure and legible together in a great many shipped interfaces. The
 * floor sits just below that: stricter would reject a pairing known to work.
 * `scripts/check-theme-contrast.ts` asserts the same number.
 */
const MIN_STATUS_DISTANCE = 70;

/** How much of the brand's saturation a status adopts. */
const SATURATION_BLEND = 0.5;

/** The saturation a status has before the brand's is blended in. */
const BASE_STATUS_SATURATION = 0.65;

/**
 * Where a status sits after leaning toward the brand, clamped to its band.
 *
 * Because the rotation is clamped rather than refused, a brand hue far from a
 * status simply parks that status at the near edge of its own band — which is
 * the most that status can honestly do to resemble the school's colour.
 */
function bandedHue(anchor: (typeof STATUS_ANCHORS)[StatusName], brandHue: number, blend: number): number {
  const rotated = anchor.hue + hueDelta(anchor.hue, brandHue) * blend;
  const [low, high] = anchor.band;
  return Math.min(high, Math.max(low, rotated));
}

/** Summed absolute channel difference. Crude, but this is a floor, not a metric. */
function channelDistance(a: Rgb, b: Rgb): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/**
 * Pushes `colour` until it clears `ratio` against *every* surface it might be
 * painted on, not merely the one it was designed against.
 *
 * A single `ensureContrast` answers "is this legible on the page", which is the
 * wrong question for any token that travels — muted text appears on the page,
 * on a card, in a table header and inside a selected row, and those are four
 * different backgrounds. Applying the push once per surface converges, because
 * on a given theme every push moves the same direction (darker on a light
 * theme, lighter on a dark one); the second pass over the list is there to
 * catch the case where satisfying a later surface loosened an earlier one.
 */
function ensureAgainstAll(colour: Rgb, surfaces: readonly Rgb[], ratio: number): Rgb {
  let result = colour;

  for (let pass = 0; pass < 2; pass += 1) {
    for (const surface of surfaces) {
      result = ensureContrast(result, surface, ratio);
    }
  }

  return result;
}

/* -----------------------------------------------------------------------------
 * Derivation.
 * -------------------------------------------------------------------------- */

export interface DerivedTheme {
  /** CSS variable name -> `r g b` channels, ready for Tailwind's alpha syntax. */
  variables: Record<string, string>;
}

function channels({ r, g, b }: Rgb): string {
  return `${r} ${g} ${b}`;
}

function parseOr(hex: string, fallback: Rgb): Rgb {
  return parseHex(hex) ?? fallback;
}

/**
 * Builds every derived token for one palette.
 *
 * `palette` is assumed already merged over the platform default, which is what
 * `paletteToCSSVars` does before calling this — so every field is present, and
 * an unparseable one falls back to a neutral rather than throwing.
 */
export function deriveThemeVariables(palette: Palette): Record<string, string> {
  const white: Rgb = { r: 255, g: 255, b: 255 };
  const black: Rgb = { r: 0, g: 0, b: 0 };

  const background = parseOr(palette.background, white);
  const ink = parseOr(palette.text, black);
  const primary = parseOr(palette.primary, { r: 29, g: 78, b: 216 });
  const accent = parseOr(palette.accent, primary);

  const darkSurface = isDark(background);

  /**
   * Which way "away from the page" points.
   *
   * On a light page a card is lighter than its surroundings and a well is
   * darker; on a dark page both invert, and the well has to go toward black
   * rather than toward the ink, which is itself near-white there. Deriving the
   * direction from the background instead of assuming a light theme is what
   * lets a school choose a near-black background without every card
   * disappearing into it.
   */
  const sink = darkSurface ? black : ink;

  const variables: Record<string, string> = {};

  /* ── Surfaces ──────────────────────────────────────────────────────────── */

  // A card. On a light page this is usually pure white; on a dark one it is the
  // background lifted just enough to read as a separate plane.
  const surfaceRaised = darkSurface ? mix(background, white, 0.08) : mix(background, white, 0.65);

  // Table headers, form wells, the inside of a disabled control.
  const surfaceSunken = darkSurface ? mix(background, black, 0.25) : mix(background, sink, 0.045);

  // Row hover, list hover. Deliberately weaker than sunken so a hovered row in
  // a table does not read as a header.
  const surfaceHover = darkSurface ? mix(background, white, 0.06) : mix(background, sink, 0.035);

  variables['--surface'] = channels(background);
  variables['--surface-raised'] = channels(surfaceRaised);
  variables['--surface-sunken'] = channels(surfaceSunken);
  variables['--surface-hover'] = channels(surfaceHover);

  /* ── Brand washes ──────────────────────────────────────────────────────────
   * Computed here, before the inks, rather than beside the other brand tokens
   * further down. They are *surfaces* — the fill behind a selected table row,
   * an active nav item, a brand-coloured badge — and `--ink-muted` has to be
   * legible on them, so they must exist before the inks are resolved.
   * -------------------------------------------------------------------------- */

  const primarySubtle = mix(primary, background, 0.88);
  const accentSubtle = mix(accent, background, 0.88);

  /**
   * Every plane that ordinary muted text can land on.
   *
   * ── The bug this list exists to prevent ──────────────────────────────────
   * `--ink-muted` was originally checked against the page and the card only,
   * and a browser audit of the rendered DOM then found eighteen real contrast
   * failures across the palettes — all of them muted text sitting on a surface
   * that was in neither of those two: table headers on `surface-sunken`,
   * neutral badges on the same, and a muted cell inside a *selected* row, which
   * is `primarySubtle`.
   *
   * It is the same mistake the status inks had, one plane over: a token
   * verified against the background it was designed for and then painted on a
   * different one. Checking against the whole set is the fix, and it is why the
   * washes are computed above rather than below.
   */
  const textPlanes = [background, surfaceRaised, surfaceSunken, primarySubtle, accentSubtle];

  /* ── Borders ───────────────────────────────────────────────────────────────
   * Two borders, because they do different jobs and only one of them is
   * decorative.
   *
   * `--border` separates things that are already distinguishable — a row from
   * the next row, a card from the page. It only has to be *visible*, and is
   * held to a floor low enough to stay quiet but high enough that a card on a
   * pure-white page still has an edge. That case matters: a school whose
   * background is `#ffffff` gets a card fill identical to the page, and this
   * border is then the only thing that makes the card a card.
   *
   * `--border-strong` is the outline of a control — a text input, a select, an
   * unfilled button. There it is not decoration but the affordance itself, the
   * thing that says "you may type here", so WCAG 1.4.11 applies and it is held
   * to the full 3:1. Mixing toward the ink does not reliably reach that on a
   * light page, which is why it is pushed rather than mixed.
   * -------------------------------------------------------------------------- */

  const borderSeed = darkSurface ? mix(background, white, 0.16) : mix(background, sink, 0.13);

  // Checked against the card as well as the page: on a light theme the card is
  // lighter than the page, so a border tuned only to the page can disappear
  // against the surface it is actually drawn on.
  const border = ensureContrast(
    ensureContrast(borderSeed, background, BORDER_CONTRAST),
    surfaceRaised,
    BORDER_CONTRAST,
  );

  variables['--border'] = channels(border);
  variables['--border-strong'] = channels(
    ensureContrast(
      darkSurface ? mix(background, white, 0.32) : mix(background, sink, 0.28),
      background,
      UI_CONTRAST,
    ),
  );

  /* ── Ink ───────────────────────────────────────────────────────────────────
   * `--ink-muted` carries secondary body copy — table sub-labels, helper text,
   * timestamps — so it is held to the full 4.5:1 even though it is *meant* to
   * look quieter. Muted grey that fails contrast is the most common single
   * defect in a themed interface, and the mix below would produce exactly that
   * if it were emitted unchecked.
   *
   * `--ink-faint` is held only to 3:1 and is therefore not a text colour. It is
   * for icon ghosts, disabled glyphs and rules.
   * -------------------------------------------------------------------------- */

  variables['--ink'] = channels(ensureAgainstAll(ink, textPlanes, TEXT_CONTRAST));
  variables['--ink-muted'] = channels(
    ensureAgainstAll(mix(ink, background, 0.38), textPlanes, TEXT_CONTRAST),
  );
  variables['--ink-faint'] = channels(
    ensureAgainstAll(mix(ink, background, 0.62), textPlanes, UI_CONTRAST),
  );

  /* ── Brand, as functional tokens ───────────────────────────────────────── */

  // `primary` is stored for use as a *fill*, and is not guaranteed to be legible
  // as text on the page. A link or an icon painted in it needs its own value —
  // and it needs it on every plane, because a brand-coloured link inside a
  // selected table row is sitting on `primarySubtle`, which is the plane made
  // out of that very colour and therefore the hardest one to be legible on.
  const primaryInk = ensureAgainstAll(primary, textPlanes, TEXT_CONTRAST);
  const accentInk = ensureAgainstAll(accent, textPlanes, TEXT_CONTRAST);

  variables['--brand-primary-ink'] = channels(primaryInk);
  variables['--brand-accent-ink'] = channels(accentInk);

  // Hover on a filled button: deepen on a light page, lift on a dark one, so
  // the direction of travel is always "more" rather than "toward white".
  variables['--brand-primary-hover'] = channels(
    darkSurface ? mix(primary, white, 0.14) : mix(primary, black, 0.14),
  );
  variables['--brand-accent-hover'] = channels(
    darkSurface ? mix(accent, white, 0.14) : mix(accent, black, 0.14),
  );

  // The washes themselves are computed further up, with the surfaces, because
  // `--ink-muted` has to be checked against them.
  variables['--brand-primary-subtle'] = channels(primarySubtle);
  variables['--brand-accent-subtle'] = channels(accentSubtle);
  variables['--brand-on-primary-subtle'] = channels(
    ensureContrast(primary, primarySubtle, TEXT_CONTRAST),
  );
  variables['--brand-on-accent-subtle'] = channels(
    ensureContrast(accent, accentSubtle, TEXT_CONTRAST),
  );

  /* ── Focus ring ────────────────────────────────────────────────────────────
   * Whichever brand colour is actually visible against the page. A school whose
   * accent is a pale gold on white would otherwise get a focus ring nobody can
   * see, which is an accessibility failure rather than a cosmetic one.
   * -------------------------------------------------------------------------- */

  const ringCandidates = [accent, primary, ink];
  const ring =
    ringCandidates.find((candidate) => contrastRatio(candidate, background) >= UI_CONTRAST) ??
    ensureContrast(accent, background, UI_CONTRAST);

  variables['--focus-ring'] = channels(ring);

  /* ── Status ────────────────────────────────────────────────────────────── */

  const brandHsl = rgbToHsl(primary);
  const saturation = clamp01(
    BASE_STATUS_SATURATION + (brandHsl.s - BASE_STATUS_SATURATION) * SATURATION_BLEND,
  );

  // Starting lightness. A status has to be visible as a solid fill *and* legible
  // as text, and the two pull in opposite directions on a dark page.
  const baseLightness = darkSurface ? 0.58 : 0.42;

  /**
   * One finished status, at a given rotation toward the brand hue.
   *
   * Built as a function of `blend` rather than inline, because the blend is
   * chosen by evaluating these — see `chooseBlend`.
   */
  const buildStatus = (name: StatusName, blend: number) => {
    const anchor = STATUS_ANCHORS[name];
    const raw = hslToRgb({
      h: bandedHue(anchor, brandHsl.h, blend),
      s: saturation,
      l: clamp01(baseLightness + anchor.lightness),
    });

    /*
     * The solid: a filled badge, a chart series, a progress bar.
     *
     * Two constraints, applied in order. It has to be visible against the page
     * (3:1), and it has to be able to *carry* lettering — a filled "OVERDUE"
     * badge is unreadable if its fill sits midway between black and white,
     * which a mid-tone amber does. So the fill is then pushed until its own
     * best foreground clears full text contrast on it. That deepens some fills,
     * and deepening them is the point.
     */
    const visible = ensureContrast(raw, background, UI_CONTRAST);
    const solid = ensureContrast(
      visible,
      parseOr(readableForeground(hexOf(visible)), background),
      TEXT_CONTRAST,
    );

    /*
     * The text form: a status word in a table cell. Checked against the card as
     * well as the page, because most status text is inside a card and on a dark
     * theme the card is the lighter of the two — so a value tuned to the page
     * alone comes up short exactly where it is actually used.
     */
    const statusInk = ensureAgainstAll(raw, textPlanes, TEXT_CONTRAST);

    const subtle = mix(solid, background, 0.86);

    return {
      solid,
      statusInk,
      subtle,
      onSolid: parseOr(readableForeground(hexOf(solid)), background),
      onSubtle: ensureContrast(raw, subtle, TEXT_CONTRAST),
    };
  };

  /**
   * The largest rotation toward the brand hue that leaves the four statuses
   * still tellable apart.
   *
   * ── Why this evaluates the finished colours rather than the hues ─────────
   * The first version of this checked hue separation alone, which is a proxy,
   * and the proxy is wrong in the orange-yellow band. Both `danger` and
   * `warning` get darkened by the contrast push above until each can carry
   * lettering, and on a white page that push converges them: two hues a
   * comfortable 31° apart came out as two browns 67 apart, under the floor.
   * Forest Linen — a shipped preset, not a contrived palette — was the case
   * that exposed it.
   *
   * So the search builds the actual fills at each candidate blend and measures
   * those. The hue gate is kept as a cheap pre-filter, but the distance check
   * is what decides. Falling all the way to 0 is a legitimate outcome: it means
   * this school's colour cannot move the statuses without merging them, and the
   * conventional hues are what it gets.
   */
  const chooseBlend = (): number => {
    for (let candidate = MAX_BLEND; candidate > 0; candidate -= 0.05) {
      const hues = STATUS_NAMES.map((name) =>
        bandedHue(STATUS_ANCHORS[name], brandHsl.h, candidate),
      );
      const huesCollapsed = hues.some((hue, index) =>
        hues.some(
          (other, otherIndex) =>
            index !== otherIndex && hueDistance(hue, other) < MIN_SEPARATION,
        ),
      );
      if (huesCollapsed) continue;

      const solids = STATUS_NAMES.map((name) => buildStatus(name, candidate).solid);
      const merged = solids.some((solid, index) =>
        solids.some(
          (other, otherIndex) =>
            index !== otherIndex && channelDistance(solid, other) < MIN_STATUS_DISTANCE,
        ),
      );
      if (!merged) return candidate;
    }

    return 0;
  };

  const statusBlend = chooseBlend();

  for (const name of STATUS_NAMES) {
    const status = buildStatus(name, statusBlend);

    variables[`--status-${name}`] = channels(status.solid);
    variables[`--status-${name}-on`] = channels(status.onSolid);
    variables[`--status-${name}-ink`] = channels(status.statusInk);
    variables[`--status-${name}-subtle`] = channels(status.subtle);
    variables[`--status-${name}-on-subtle`] = channels(status.onSubtle);
  }

  /* ── Chart series ──────────────────────────────────────────────────────────
   * A categorical ramp for the dashboards, spread around the brand hue rather
   * than sampled from a fixed palette, so a chart belongs to the school it is
   * drawn for. Six is enough for every chart in Sprint 10.5's table; beyond that
   * a chart needs a different form, not more colours.
   *
   * Spread across 200° rather than the full wheel: a full rotation would bring
   * the last series back around to the brand hue and produce two series that
   * look the same, which is worse than a narrower range.
   * -------------------------------------------------------------------------- */

  const SERIES_COUNT = 6;
  const SERIES_SPREAD = 200;

  for (let index = 0; index < SERIES_COUNT; index += 1) {
    const hue = brandHsl.h + (SERIES_SPREAD / SERIES_COUNT) * index;
    // Alternating lightness so adjacent series differ in value as well as hue,
    // which is what keeps them apart when printed in greyscale.
    const lightness = baseLightness + (index % 2 === 0 ? 0 : darkSurface ? -0.1 : 0.12);

    const series = ensureContrast(
      hslToRgb({ h: hue, s: clamp01(saturation * 0.95), l: clamp01(lightness) }),
      background,
      UI_CONTRAST,
    );

    variables[`--chart-${index + 1}`] = channels(series);
  }

  return variables;
}

/** `{r,g,b}` -> `#rrggbb`, for the one helper that takes a hex string. */
function hexOf({ r, g, b }: Rgb): string {
  const pair = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${pair(r)}${pair(g)}${pair(b)}`;
}
