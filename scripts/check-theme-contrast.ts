/**
 * Contrast audit for the derived theme, run against deliberately hostile
 * palettes.
 *
 * ── Why this is a script and not a note in a checklist ────────────────────
 * `SPRINTS.md` Sprint 10.5 requires that the design system be verified against
 * "a very dark primary, a very light one, and a saturated mid-tone" before
 * anything is called done, because there is no single palette to design
 * against — each school picks its own at runtime and it can be anything.
 *
 * A human checking that by eye, once, does not survive the next change to
 * `lib/brand-derive.ts`. This does: it asserts the contract every derived token
 * is supposed to satisfy — that each one is legible on the surface it will
 * actually be painted on — across six palettes including three chosen to break
 * it. Run it after touching the derivation.
 *
 *   npm run check-theme
 *
 * Exit code 1 on any violation, so it can be wired into CI later.
 */

import {
  contrastRatio,
  parseHex,
  rgbToHsl,
  type Rgb,
} from '../lib/color-contrast';
import { deriveThemeVariables } from '../lib/brand-derive';
import { DEFAULT_PALETTE } from '../lib/branding';
import { PALETTE_PRESETS } from '../lib/palette-presets';

import type { Palette } from '../db/schema/school-branding';

/* -----------------------------------------------------------------------------
 * The palettes under test.
 *
 * The three hostile ones are not arbitrary. Each targets a different way the
 * derivation can fail:
 *
 *   dark      — every "mix toward white" assumption inverts. Cards, wells and
 *               borders all have to change direction or the interface goes flat.
 *   pale gold — the classic §5p failure. A primary this light cannot carry white
 *               lettering and cannot be used as link text without adjustment.
 *   maroon    — a saturated mid-tone sits close to the danger anchor, which is
 *               the case most likely to collapse the status colours together.
 * -------------------------------------------------------------------------- */

const HOSTILE: ReadonlyArray<readonly [string, Palette]> = [
  [
    'HOSTILE — very dark background, violet primary',
    {
      primary: '#7c3aed',
      secondary: '#020617',
      accent: '#a78bfa',
      background: '#0b0b10',
      text: '#f5f5f7',
    },
  ],
  [
    'HOSTILE — very light, pale gold (the §5p case)',
    {
      primary: '#f5d90a',
      secondary: '#fef9c3',
      accent: '#fde047',
      background: '#fffdf0',
      text: '#3f3f00',
    },
  ],
  [
    'HOSTILE — saturated mid-tone maroon (sits on the danger anchor)',
    {
      primary: '#8b1538',
      secondary: '#5c0e24',
      accent: '#d4145a',
      background: '#f7eef1',
      text: '#2b0a15',
    },
  ],
];

const CASES: ReadonlyArray<readonly [string, Palette]> = [
  ['platform default', DEFAULT_PALETTE],
  ...PALETTE_PRESETS.map(
    (preset) => [`preset — ${preset.name}`, preset.palette] as const,
  ),
  ...HOSTILE,
];

/* -----------------------------------------------------------------------------
 * The contract.
 * -------------------------------------------------------------------------- */

const STATUSES = ['danger', 'warning', 'success', 'info'] as const;

/** Foreground token -> the token it is painted on. Must clear 4.5:1. */
const TEXT_PAIRS: Array<[string, string]> = [
  ['--ink', '--surface'],
  ['--ink', '--surface-raised'],
  ['--ink-muted', '--surface'],
  ['--ink-muted', '--surface-raised'],
  ['--brand-primary-ink', '--surface'],
  ['--brand-accent-ink', '--surface'],
  ['--brand-on-primary-subtle', '--brand-primary-subtle'],
  ['--brand-on-accent-subtle', '--brand-accent-subtle'],
];

/** Must clear 3:1 — UI components and large text, never body copy. */
const UI_PAIRS: Array<[string, string]> = [
  ['--focus-ring', '--surface'],
  ['--border-strong', '--surface'],
  ['--ink-faint', '--surface'],
];

for (const status of STATUSES) {
  TEXT_PAIRS.push([`--status-${status}-ink`, '--surface']);
  TEXT_PAIRS.push([`--status-${status}-ink`, '--surface-raised']);
  TEXT_PAIRS.push([`--status-${status}-on-subtle`, `--status-${status}-subtle`]);
  TEXT_PAIRS.push([`--status-${status}-on`, `--status-${status}`]);
  UI_PAIRS.push([`--status-${status}`, '--surface']);
}

for (let index = 1; index <= 6; index += 1) {
  UI_PAIRS.push([`--chart-${index}`, '--surface']);
}

/**
 * Below this, two status colours are not reliably tellable apart at badge size.
 * Summed absolute RGB distance — crude, but it is a floor rather than a
 * measurement, and it catches the collapse this is guarding against.
 *
 * Calibrated against a known-good reference rather than picked: Tailwind's own
 * `red-700` (#b91c1c) and `amber-700` (#b45309) — a pairing shipped in a great
 * many production interfaces and legible in all of them — are 79 apart by this
 * measure. A floor above that would fail a palette that demonstrably works, so
 * it sits just below.
 */
const MIN_STATUS_DISTANCE = 70;

/**
 * A card has to be separable from the page behind it — but not necessarily by
 * fill. A school whose background is `#ffffff` gets a card the same colour as
 * its page, and that is a legitimate design as long as the card has an edge, so
 * what is asserted is that the border is visible against *both* planes rather
 * than that the two planes differ.
 */
const MIN_BORDER_VISIBILITY = 1.3;

/* -----------------------------------------------------------------------------
 * Run.
 * -------------------------------------------------------------------------- */

function toRgb(channels: string | undefined, token: string): Rgb {
  if (channels === undefined) throw new Error(`derivation never emitted ${token}`);
  const [r, g, b] = channels.split(' ').map(Number);
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
}

function distance(a: Rgb, b: Rgb): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/*
 * `--css` prints the platform default's derived variables as a CSS block.
 *
 * `app/globals.css` needs them literally: a portal shell applies a school's
 * palette inline, but the sign-in screen, the invitation acceptance page and
 * every other public route render outside any portal and fall back to `:root`.
 * Those defaults are the same arithmetic as everything else in this file, so
 * they are emitted from it rather than hand-maintained beside it — a hand-typed
 * copy is a second source of truth that will drift the first time the
 * derivation changes.
 */
if (process.argv.includes('--css')) {
  const vars = deriveThemeVariables(DEFAULT_PALETTE);
  for (const [token, value] of Object.entries(vars)) {
    console.log(`    ${token}: ${value};`);
  }
  process.exit(0);
}

let violations = 0;

for (const [name, palette] of CASES) {
  const vars = deriveThemeVariables(palette);
  const problems: string[] = [];

  for (const [foreground, background] of TEXT_PAIRS) {
    const ratio = contrastRatio(
      toRgb(vars[foreground], foreground),
      toRgb(vars[background], background),
    );
    if (ratio < 4.5) {
      problems.push(`TEXT  ${foreground} on ${background} = ${ratio.toFixed(2)} (need 4.50)`);
    }
  }

  for (const [foreground, background] of UI_PAIRS) {
    const ratio = contrastRatio(
      toRgb(vars[foreground], foreground),
      toRgb(vars[background], background),
    );
    if (ratio < 3) {
      problems.push(`UI    ${foreground} on ${background} = ${ratio.toFixed(2)} (need 3.00)`);
    }
  }

  const surfaceSeparation = contrastRatio(
    toRgb(vars['--surface'], '--surface'),
    toRgb(vars['--surface-raised'], '--surface-raised'),
  );

  const borderOnPage = contrastRatio(
    toRgb(vars['--border'], '--border'),
    toRgb(vars['--surface'], '--surface'),
  );
  const borderOnCard = contrastRatio(
    toRgb(vars['--border'], '--border'),
    toRgb(vars['--surface-raised'], '--surface-raised'),
  );

  if (borderOnPage < MIN_BORDER_VISIBILITY || borderOnCard < MIN_BORDER_VISIBILITY) {
    problems.push(
      `EDGE  --border is invisible (page ${borderOnPage.toFixed(2)}, card ${borderOnCard.toFixed(2)}, need ${MIN_BORDER_VISIBILITY}) — a card with neither fill separation nor an edge is not a card`,
    );
  }

  let closestStatuses = Infinity;
  let closestPair = '';
  for (let i = 0; i < STATUSES.length; i += 1) {
    for (let j = i + 1; j < STATUSES.length; j += 1) {
      const a = toRgb(vars[`--status-${STATUSES[i]}`], 'status');
      const b = toRgb(vars[`--status-${STATUSES[j]}`], 'status');
      const gap = distance(a, b);
      if (gap < closestStatuses) {
        closestStatuses = gap;
        closestPair = `${STATUSES[i]}/${STATUSES[j]}`;
      }
    }
  }
  if (closestStatuses < MIN_STATUS_DISTANCE) {
    problems.push(
      `MERGE status ${closestPair} are too close to tell apart (distance ${closestStatuses})`,
    );
  }

  const brandHue = Math.round(rgbToHsl(parseHex(palette.primary) ?? { r: 0, g: 0, b: 0 }).h);

  console.log(`\n=== ${name} ===`);
  console.log(
    `    brand hue ${String(brandHue).padStart(3)}°  ·  surface/raised ${surfaceSeparation.toFixed(3)}  ·  closest statuses ${closestPair} @ ${closestStatuses}`,
  );

  if (problems.length === 0) {
    console.log('    ✓ every derived token clears its floor');
  } else {
    violations += problems.length;
    for (const problem of problems) console.log(`    ✗ ${problem}`);
  }
}

console.log(
  violations === 0
    ? `\nPASS — ${CASES.length} palettes, every derived token legible on its own surface.`
    : `\nFAIL — ${violations} violation(s) across ${CASES.length} palettes.`,
);

process.exitCode = violations === 0 ? 0 : 1;
