/**
 * `window.google`, which `@types/google.maps` does not declare.
 *
 * That package declares the `google.maps` *namespace* as a global type, which
 * is what you want for annotating values, but it says nothing about the runtime
 * property the Maps script actually attaches to `window`. Reading it through
 * `window` rather than the bare `google` identifier is deliberate:
 * `components/ui/LocationPicker.tsx` has to ask whether the script has loaded
 * *yet*, and a bare `google.maps` reference throws a ReferenceError when it has
 * not, where `window.google?.maps` is simply `undefined`.
 *
 * Optional for the same reason — the script is loaded on demand and may never
 * be loaded at all when no API key is configured.
 */
declare global {
  interface Window {
    google?: typeof google;
    /**
     * Google's authentication-failure hook.
     *
     * The Maps library calls this global, if it is defined, when it rejects the
     * key — invalid, referrer not on the allow-list, billing switched off. It is
     * a documented API with no type of its own because it is set on `window`
     * rather than imported.
     *
     * It does **not** cover every failure. `ApiTargetBlockedMapError` — a key
     * whose API restrictions exclude Maps JavaScript API — was measured not to
     * fire it, which is why `LocationPicker` also looks for the error panel
     * Google paints into the map container.
     */
    gm_authFailure?: () => void;
  }
}

export {};
