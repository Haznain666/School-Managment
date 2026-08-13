import type { Config } from 'tailwindcss';

/**
 * Brand tokens are exposed as CSS variables so that a school's selected palette
 * can override them per-tenant at runtime. See `lib/branding.ts` for the
 * variable names and defaults.
 *
 * The `on*` colours are foregrounds: what to write on a surface painted in the
 * colour of the same name. They are computed per palette rather than stored, so
 * `bg-brand-primary text-brand-onPrimary` stays legible whatever a school's
 * primary turns out to be — which `text-white` did not.
 *
 * ── Sprint 10.5 ──────────────────────────────────────────────────────────
 * Everything below `brand` is new, and exists because five colours reached the
 * shell and nothing else. `surface`, `line`, `ink`, `status` and `chart` are all
 * *derived* from the same five by `lib/brand-derive.ts` and emitted as CSS
 * variables by the same `paletteToCSSVars` call the shells already made, so a
 * school's palette now reaches the bottom of the interface rather than the top
 * inch of it.
 *
 * **The rule for anything built from here on: no `slate-*`, no `text-white`, no
 * `bg-white`, no `red-600` in application code.** Those are what made a
 * five-colour template render as a grey CRM with a coloured frame. Reach for
 * `surface`, `ink`, `line` and `status` instead; every one of them is contrast-
 * checked against the school's own background by `npm run check-theme`.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--brand-primary) / <alpha-value>)',
          primary: 'rgb(var(--brand-primary) / <alpha-value>)',
          secondary: 'rgb(var(--brand-secondary) / <alpha-value>)',
          accent: 'rgb(var(--brand-accent) / <alpha-value>)',
          background: 'rgb(var(--brand-background) / <alpha-value>)',
          text: 'rgb(var(--brand-text) / <alpha-value>)',
          onPrimary: 'rgb(var(--brand-on-primary) / <alpha-value>)',
          onSecondary: 'rgb(var(--brand-on-secondary) / <alpha-value>)',
          onAccent: 'rgb(var(--brand-on-accent) / <alpha-value>)',

          // `primary` is stored to be used as a *fill* and is not guaranteed to
          // be legible as text on the page. Link text and standalone icons in
          // the brand colour take these instead.
          primaryInk: 'rgb(var(--brand-primary-ink) / <alpha-value>)',
          accentInk: 'rgb(var(--brand-accent-ink) / <alpha-value>)',

          primaryHover: 'rgb(var(--brand-primary-hover) / <alpha-value>)',
          accentHover: 'rgb(var(--brand-accent-hover) / <alpha-value>)',

          // The wash behind a selected row or a brand-coloured badge, with the
          // foreground that has been checked against it.
          primarySubtle: 'rgb(var(--brand-primary-subtle) / <alpha-value>)',
          accentSubtle: 'rgb(var(--brand-accent-subtle) / <alpha-value>)',
          onPrimarySubtle: 'rgb(var(--brand-on-primary-subtle) / <alpha-value>)',
          onAccentSubtle: 'rgb(var(--brand-on-accent-subtle) / <alpha-value>)',
        },

        /** Planes. `DEFAULT` is the page, `raised` is a card, `sunken` is a well. */
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
          hover: 'rgb(var(--surface-hover) / <alpha-value>)',
        },

        /**
         * Edges. `line` separates things; `line-strong` is the outline of a
         * control, where the border *is* the affordance and so carries a real
         * contrast guarantee.
         */
        line: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },

        /**
         * Text. `muted` is secondary body copy and is contrast-guaranteed;
         * `faint` is **not a text colour** — it clears only 3:1 and is for icon
         * ghosts, disabled glyphs and rules.
         */
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },

        /**
         * Status. Each has four forms: the solid fill, the lettering that goes
         * on that fill (`on`), the standalone text colour (`ink`), and the
         * tinted-badge pair (`subtle` / `onSubtle`).
         *
         * All four statuses are derived from the school's palette but held
         * inside their conventional hue bands, so they lean toward the brand
         * without swapping meanings. See `lib/brand-derive.ts`.
         */
        status: {
          danger: {
            DEFAULT: 'rgb(var(--status-danger) / <alpha-value>)',
            on: 'rgb(var(--status-danger-on) / <alpha-value>)',
            ink: 'rgb(var(--status-danger-ink) / <alpha-value>)',
            subtle: 'rgb(var(--status-danger-subtle) / <alpha-value>)',
            onSubtle: 'rgb(var(--status-danger-on-subtle) / <alpha-value>)',
          },
          warning: {
            DEFAULT: 'rgb(var(--status-warning) / <alpha-value>)',
            on: 'rgb(var(--status-warning-on) / <alpha-value>)',
            ink: 'rgb(var(--status-warning-ink) / <alpha-value>)',
            subtle: 'rgb(var(--status-warning-subtle) / <alpha-value>)',
            onSubtle: 'rgb(var(--status-warning-on-subtle) / <alpha-value>)',
          },
          success: {
            DEFAULT: 'rgb(var(--status-success) / <alpha-value>)',
            on: 'rgb(var(--status-success-on) / <alpha-value>)',
            ink: 'rgb(var(--status-success-ink) / <alpha-value>)',
            subtle: 'rgb(var(--status-success-subtle) / <alpha-value>)',
            onSubtle: 'rgb(var(--status-success-on-subtle) / <alpha-value>)',
          },
          info: {
            DEFAULT: 'rgb(var(--status-info) / <alpha-value>)',
            on: 'rgb(var(--status-info-on) / <alpha-value>)',
            ink: 'rgb(var(--status-info-ink) / <alpha-value>)',
            subtle: 'rgb(var(--status-info-subtle) / <alpha-value>)',
            onSubtle: 'rgb(var(--status-info-on-subtle) / <alpha-value>)',
          },
        },

        /**
         * Categorical chart series, spread around the brand hue. Six, because
         * beyond six a chart needs a different form rather than more colours.
         */
        chart: {
          1: 'rgb(var(--chart-1) / <alpha-value>)',
          2: 'rgb(var(--chart-2) / <alpha-value>)',
          3: 'rgb(var(--chart-3) / <alpha-value>)',
          4: 'rgb(var(--chart-4) / <alpha-value>)',
          5: 'rgb(var(--chart-5) / <alpha-value>)',
          6: 'rgb(var(--chart-6) / <alpha-value>)',
        },
      },

      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Admission numbers, challan numbers, amounts and dates in tables. A
        // tabular figure stops a column of money from dancing as it re-renders.
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      /**
       * Additions to Tailwind's scale, and optical tracking on the heading
       * steps. Deliberately **not** a replacement scale.
       *
       * A tighter, denser ramp would suit a CRM better in the abstract, but
       * `text-sm` and `text-base` are load-bearing across 105 existing
       * components and redefining them would resize every screen in the
       * product — including the ones this sprint is not touching, which is
       * exactly the kind of collateral change Sprint 10.5 is scoped against.
       * The ramp stays; the headings get the negative tracking they should
       * always have had, and two new steps are added for things the default
       * scale has no answer for.
       *
       * Fixed rem throughout, not fluid clamp(): this is product UI viewed at a
       * consistent DPI, and a heading that shrinks when it lands in a narrow
       * column looks worse rather than better.
       */
      fontSize: {
        // Table column headers, badge text, dense metadata.
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        // Dashboard KPI figures, read as quantities rather than as prose.
        stat: ['2rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],

        '2xl': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.014em' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.017em' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.02em' }],
      },

      borderRadius: {
        card: '0.75rem',
        control: '0.5rem',
        pill: '9999px',
      },

      /**
       * Elevation. Four steps, each tied to a job rather than a number, so two
       * components at the same conceptual height cannot drift apart.
       */
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 8px 24px rgb(15 23 42 / 0.06)',
        raised: '0 1px 2px rgb(15 23 42 / 0.06), 0 2px 4px rgb(15 23 42 / 0.04)',
        popover: '0 4px 6px rgb(15 23 42 / 0.05), 0 12px 32px rgb(15 23 42 / 0.12)',
        modal: '0 8px 12px rgb(15 23 42 / 0.08), 0 32px 64px rgb(15 23 42 / 0.20)',
      },

      /**
       * A semantic z-index scale. Arbitrary values like 999 are how two
       * overlays end up fighting; a name says what is meant to be on top.
       */
      zIndex: {
        dropdown: '1000',
        sticky: '1100',
        backdrop: '1200',
        modal: '1300',
        toast: '1400',
        tooltip: '1500',
      },

      /**
       * Exponential ease-out. Motion here conveys state — a panel arriving, a
       * row selecting — so it should decelerate into place and never overshoot.
       * No bounce, no elastic: this is a tool, not a toy.
       */
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },

      transitionDuration: {
        // Users are in a task. 150–250ms covers everything here.
        fast: '120ms',
        DEFAULT: '180ms',
        slow: '240ms',
      },

      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Skeletons. A sweep rather than a pulse, because a pulse at the same
        // rate across a dozen rows reads as a fault light.
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
      },

      animation: {
        'fade-in': 'fade-in 180ms cubic-bezier(0.25, 1, 0.5, 1)',
        'slide-up': 'slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
