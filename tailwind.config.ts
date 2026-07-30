import type { Config } from 'tailwindcss';

/**
 * Brand tokens are exposed as CSS variables so that a school's `color_palette`
 * (stored on `school_subdomains`) can override them per-tenant at runtime.
 * See `lib/branding.ts` for the variable names and defaults.
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
          surface: 'rgb(var(--brand-surface) / <alpha-value>)',
          text: 'rgb(var(--brand-text) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '0.75rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 8px 24px rgb(15 23 42 / 0.06)',
      },
    },
  },
  plugins: [],
};

export default config;
