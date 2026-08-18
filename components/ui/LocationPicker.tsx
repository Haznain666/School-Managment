'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

// The pin overlay's styles. Opt-in since the library's v2 — without it the
// marker renders as an unpositioned block in the corner of the map.
import 'location-picker/style.css';

import { Input } from '@/components/ui/Input';
import { publicEnv } from '@/lib/env';
import { cn } from '@/lib/utils';

/**
 * An address field with a map beside it.
 *
 * ── What this wraps, and what it adds ────────────────────────────────────
 * `location-picker` (cyphercodes, MIT) does one job: it puts a draggable pin on
 * a Google map and tells you where the pin is. Everything an *address field*
 * needs beyond that is here — loading the Maps script once per page, turning a
 * pin into a postal address and back, keeping the typed text and the pin in
 * step, and behaving sensibly when there is no map at all.
 *
 * ── Absent-key behaviour is the important part ───────────────────────────
 * The Maps JavaScript API needs a key attached to a billed Google Cloud
 * account. This deployment may not have one, and a school profile form must not
 * stop working because of that. With no `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` this
 * renders exactly the plain text input the form had before, plus one line
 * saying why there is no map. Same for a key that is present but rejected: the
 * script's failure is caught and degrades to the same input rather than leaving
 * an empty grey box the operator will report as a bug.
 *
 * A key that is *present and rejected* is the harder case and is handled
 * explicitly further down: the script still loads, so nothing throws, and
 * Google paints its own error panel into the map. See the block around
 * `gm-err-container`.
 *
 * That is also why the address stays a free-text field that is merely
 * *assisted* by the map, rather than being derived from it. Plenty of Pakistani
 * school addresses — a block and a sector, a landmark, a lane with no name —
 * are not what a geocoder returns, and an operator must always be able to
 * overrule the machine. The pin is the enrichment; the text is the record.
 *
 * ── The two directions ───────────────────────────────────────────────────
 * Dropping the pin reverse-geocodes and offers to overwrite the text (it asks
 * rather than assuming, because the operator may have typed something better).
 * Pressing Find on typed text forward-geocodes and moves the pin. Neither is
 * automatic on every keystroke: geocoding is billed per call, and firing one
 * per character is how a maps bill arrives.
 */

export interface LocationValue {
  address: string;
  latitude: number | null;
  longitude: number | null;
}

export interface LocationPickerProps {
  label?: string;
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  disabled?: boolean;
  error?: string;
  hint?: string;
  className?: string;
}

/** Karachi. Where the map opens when nothing has been picked yet. */
const DEFAULT_CENTER = { lat: 24.8607, lng: 67.0011 };

type ScriptState = 'absent' | 'loading' | 'ready' | 'failed';

/**
 * Loads the Maps JS API once per document.
 *
 * Module-level rather than per-component because two pickers on one page — or
 * one picker remounted by a re-render — must not each append a `<script>`.
 * Google's loader throws loudly when its script is included twice, and the
 * second copy would clobber the first's `google.maps` namespace mid-use.
 */
let mapsScript: Promise<void> | null = null;

function loadMapsScript(apiKey: string): Promise<void> {
  if (mapsScript !== null) return mapsScript;

  mapsScript = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('The Maps API can only be loaded in a browser.'));
      return;
    }

    if (window.google?.maps !== undefined) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      resolve();
    });
    script.addEventListener('error', () => {
      // Cleared so a later mount may retry — a failed load is usually a network
      // blip or a referrer restriction being fixed, both of which resolve.
      mapsScript = null;
      reject(new Error('The Google Maps script could not be loaded.'));
    });

    document.head.append(script);
  });

  return mapsScript;
}

export function LocationPicker({
  label = 'Address',
  value,
  onChange,
  disabled = false,
  error,
  hint,
  className,
}: LocationPickerProps) {
  const apiKey = publicEnv.googleMapsApiKey;
  const mapId = useId();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<{ setLocation: (lat: number, lng: number) => void; destroy: () => void } | null>(null);

  const [scriptState, setScriptState] = useState<ScriptState>(
    apiKey === '' ? 'absent' : 'loading',
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);

  /**
   * `onChange` in a ref, read by the map's idle callback.
   *
   * The picker is constructed once and holds whatever callback it was given
   * forever. Passing `onChange` directly would freeze the first render's
   * closure, so the pin would write its coordinates onto a stale `value` and
   * silently wipe whatever the operator typed afterwards. Listing it as an
   * effect dependency instead would tear down and rebuild the whole map on
   * every keystroke in the address field.
   */
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  useEffect(() => {
    if (apiKey === '') return;

    let cancelled = false;

    void (async () => {
      try {
        await loadMapsScript(apiKey);
        const { LocationPicker: Picker } = await import('location-picker');

        if (cancelled || mapRef.current === null) return;

        /**
         * Registered *before* the first map is constructed, which is the only
         * time it works.
         *
         * Google calls this hook at the moment it rejects the key, and it does
         * not replay: a handler installed after that moment is never called.
         * Measured both ways — registered first it fires, registered after the
         * map it does not, which is a difference invisible from the docs.
         */
        window.gm_authFailure = () => {
          setScriptState('failed');
        };

        const start =
          value.latitude !== null && value.longitude !== null
            ? { lat: value.latitude, lng: value.longitude }
            : DEFAULT_CENTER;

        pickerRef.current = new Picker(
          mapRef.current,
          {
            lat: start.lat,
            lng: start.lng,
            // Off deliberately. Asking for the browser's location throws a
            // permission prompt at an operator who is entering *a school's*
            // address, not their own, and the answer is never useful.
            setCurrentPosition: false,
            onLocationChange: (position) => {
              const current = latest.current;
              if (
                current.value.latitude === position.lat &&
                current.value.longitude === position.lng
              ) {
                return;
              }
              current.onChange({
                ...current.value,
                latitude: position.lat,
                longitude: position.lng,
              });
            },
          },
          { zoom: value.latitude === null ? 11 : 16, streetViewControl: false },
        ) as unknown as { setLocation: (lat: number, lng: number) => void; destroy: () => void };

        /**
         * A map that loaded and still does not work.
         *
         * ── Why the script loading is not the same as the map working ──────
         * `https://maps.googleapis.com/maps/api/js` returns 200 and a valid
         * loader for *any* key, valid or not. The rejection happens later,
         * inside the library, and it is not thrown — Google paints its own
         * "Oops! Something went wrong" panel into the container and logs to the
         * console. So the `catch` below never fires and `scriptState` would sit
         * at `ready` forever, showing the operator a grey error box where a map
         * should be, with no explanation and two buttons that silently do
         * nothing.
         *
         * This was found with a real key: billing was not enabled on the
         * project and the key's API restrictions did not include Maps
         * JavaScript API, which produces `ApiTargetBlockedMapError`.
         *
         * ── Why `gm_authFailure` is not enough on its own ─────────────────
         * Google documents that hook for auth failures, and it is registered
         * below because it does cover the common ones — an invalid key, a
         * referrer that is not on the allow-list, billing switched off. It was
         * measured *not* to fire for `ApiTargetBlockedMapError`. Hence also
         * looking for the error panel Google injects, which is the one signal
         * present in every one of these cases.
         *
         * A frame is allowed to pass first: the panel is painted during the
         * map's own initialisation, not synchronously in the constructor.
         *
         * One caveat, also measured: only the **first** map on a page gets the
         * panel — a second one renders an empty container. That is fine here
         * because a form has one address field, but it is why this is the
         * second signal and `gm_authFailure` above is the first.
         */
        await new Promise((resolve) => {
          setTimeout(resolve, 1200);
        });

        if (cancelled) return;

        if (mapRef.current?.querySelector('.gm-err-container') != null) {
          setScriptState('failed');
          return;
        }

        setScriptState('ready');
      } catch {
        if (!cancelled) setScriptState('failed');
      }
    })();

    return () => {
      cancelled = true;
      pickerRef.current?.destroy();
      pickerRef.current = null;
    };
    // Constructed once. `value` is read through `latest` for the reason above,
    // and re-running this would rebuild the map under the operator's cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  /**
   * Stops a geocode that will never answer.
   *
   * `Geocoder.geocode` takes a callback and, when the API is blocked or the
   * project is unbilled, simply never calls it — no error, no rejection. That
   * was measured, not assumed. Without a ceiling the buttons stay disabled and
   * the operator is left with a form that has quietly stopped responding, which
   * reads as a broken page rather than a misconfigured key.
   *
   * Ten seconds is far longer than a healthy geocode, which answers in well
   * under one.
   */
  const geocodeGuard = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startGeocode = useCallback(() => {
    setIsGeocoding(true);
    setNotice(null);

    if (geocodeGuard.current !== null) clearTimeout(geocodeGuard.current);
    geocodeGuard.current = setTimeout(() => {
      setIsGeocoding(false);
      setNotice(
        'The map service did not answer. The address you typed is still saved — ' +
          'check the Google Maps key’s billing and API restrictions.',
      );
    }, 10_000);
  }, []);

  const endGeocode = useCallback(() => {
    if (geocodeGuard.current !== null) {
      clearTimeout(geocodeGuard.current);
      geocodeGuard.current = null;
    }
    setIsGeocoding(false);
  }, []);

  useEffect(
    () => () => {
      if (geocodeGuard.current !== null) clearTimeout(geocodeGuard.current);
    },
    [],
  );

  /** Typed address → pin. */
  const findOnMap = useCallback(() => {
    const address = latest.current.value.address.trim();
    if (address === '' || window.google?.maps === undefined) return;

    startGeocode();

    new window.google.maps.Geocoder().geocode(
      // Biased to Pakistan: "Model Town" and "Gulberg" exist in several
      // countries, and an unbiased geocoder picks whichever has more traffic.
      { address, componentRestrictions: { country: 'PK' } },
      (results, status) => {
        endGeocode();

        const first = results?.[0];
        if (status !== 'OK' || first === undefined) {
          setNotice('That address could not be found on the map. Drop the pin by hand instead.');
          return;
        }

        const location = first.geometry.location;
        pickerRef.current?.setLocation(location.lat(), location.lng());
        latest.current.onChange({
          ...latest.current.value,
          latitude: location.lat(),
          longitude: location.lng(),
        });
      },
    );
  }, [startGeocode, endGeocode]);

  /** Pin → typed address, on request. */
  const useMapAddress = useCallback(() => {
    const { latitude, longitude } = latest.current.value;
    if (latitude === null || longitude === null || window.google?.maps === undefined) return;

    startGeocode();

    new window.google.maps.Geocoder().geocode(
      { location: { lat: latitude, lng: longitude } },
      (results, status) => {
        endGeocode();

        const first = results?.[0];
        if (status !== 'OK' || first === undefined) {
          setNotice('No street address is known for that point. Type it in instead.');
          return;
        }

        latest.current.onChange({
          ...latest.current.value,
          address: first.formatted_address,
        });
      },
    );
  }, [startGeocode, endGeocode]);

  const hasPin = value.latitude !== null && value.longitude !== null;

  return (
    <div className={cn('w-full space-y-2', className)}>
      <Input
        label={label}
        value={value.address}
        onChange={(event) => {
          onChange({ ...value, address: event.target.value });
        }}
        disabled={disabled}
        error={error}
        hint={
          hint ??
          (scriptState === 'ready'
            ? 'Type the address, or drag the pin to the exact spot.'
            : undefined)
        }
        placeholder="Plot 12, Block 6, PECHS"
      />

      {scriptState === 'absent' || scriptState === 'failed' ? (
        <p className="text-xs text-ink-muted">
          {scriptState === 'absent'
            ? 'Map picking is off — no Google Maps key is configured for this deployment. The address above is still saved.'
            : 'The map could not be loaded, so the address above is being saved as typed.'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={findOnMap}
              disabled={disabled || isGeocoding || value.address.trim() === '' || scriptState !== 'ready'}
              className="rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-ink-muted"
            >
              Find on map
            </button>

            <button
              type="button"
              onClick={useMapAddress}
              disabled={disabled || isGeocoding || !hasPin || scriptState !== 'ready'}
              className="rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-ink-muted"
            >
              Use the pin&rsquo;s address
            </button>

            {hasPin ? (
              <span className="font-mono text-xs tabular-nums text-ink-muted">
                {value.latitude?.toFixed(5)}, {value.longitude?.toFixed(5)}
              </span>
            ) : null}
          </div>

          <div
            id={mapId}
            ref={mapRef}
            aria-label="Map for choosing the address location"
            className={cn(
              'h-56 w-full overflow-hidden rounded-lg border border-line-strong bg-surface-sunken',
              disabled && 'pointer-events-none opacity-60',
            )}
          />

          {notice !== null ? <p className="text-xs text-status-warning-ink">{notice}</p> : null}
        </>
      )}
    </div>
  );
}
