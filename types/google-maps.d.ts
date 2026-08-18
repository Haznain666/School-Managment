import type { DetailedHTMLProps, HTMLAttributes, Ref } from 'react';

/**
 * The Google Maps globals and custom elements TypeScript cannot infer.
 *
 * ── `window.google` ──────────────────────────────────────────────────────
 * `@types/google.maps` declares the `google.maps` *namespace* as a global type,
 * which is what you want for annotating values, but says nothing about the
 * runtime property the Maps script attaches to `window`. Reading it through
 * `window` rather than the bare `google` identifier matters when code has to
 * ask whether the script has loaded *yet*: a bare `google.maps` reference
 * throws a ReferenceError when it has not, where `window.google?.maps` is
 * simply `undefined`.
 *
 * ── The custom elements ──────────────────────────────────────────────────
 * `@googlemaps/extended-component-library` ships Lit web components, not React
 * components. It registers them with `customElements.define`, so React renders
 * them as unknown intrinsic elements and TypeScript rejects the JSX unless the
 * tags are declared here.
 *
 * The declarations are deliberately narrow — only the attributes
 * `LocationPicker` actually sets. Everything else those elements accept is set
 * imperatively through a ref, which is required anyway for `apiKey` (React
 * reserves `key`) and is the more reliable path for any non-string property,
 * because React passes unknown JSX props to custom elements as *attributes*
 * and an array or an object would be stringified.
 */
declare global {
  interface Window {
    google?: typeof google;
    /**
     * Google's authentication-failure hook.
     *
     * The Maps library calls this global, if defined, when it rejects the key —
     * invalid, referrer not on the allow-list, billing switched off. A
     * documented API with no type of its own, because it is set on `window`
     * rather than imported.
     *
     * It does not cover every failure, and it only fires if it is registered
     * *before* the first map is constructed — it does not replay. Both were
     * measured; see STATE.md §5ai.
     */
    gm_authFailure?: () => void;
  }

}

/**
 * React 19 resolves JSX through `React.JSX`, not the old global `JSX`
 * namespace, so augmenting the global one silently does nothing — the JSX still
 * fails to compile and the only clue is a `@ts-expect-error` that keeps being
 * "used". This module augmentation is the form that actually takes effect.
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'gmpx-api-loader': DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          ref?: Ref<HTMLElement>;
          /** Attribution channel Google asks integrations to declare. */
          'solution-channel'?: string;
        },
        HTMLElement
      >;
      'gmpx-place-picker': DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          ref?: Ref<HTMLElement>;
          placeholder?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
