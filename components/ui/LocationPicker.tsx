'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/Input';
import { publicEnv } from '@/lib/env';
import { cn } from '@/lib/utils';

/**
 * An address field with Google Place Autocomplete.
 *
 * ── What replaced what, and why ──────────────────────────────────────────
 * This was a draggable pin on a Google map (`cyphercodes/location-picker`).
 * It is now `<gmpx-place-picker>` from Google's own Extended Component
 * Library, which is a text input that completes against the Places database.
 *
 * The map was the wrong instrument for this field. Entering a school's address
 * is a *naming* task, not a *pointing* task — the operator knows the address
 * and wants to write it down, and a map made them find a rooftop on a tile
 * they had to pan and zoom to reach. Autocomplete matches what they are
 * actually doing: they type "Beaconhouse Johar Town", pick it from four
 * suggestions, and the address and its coordinates arrive together. Coordinates
 * are still captured — they come from the selected place rather than from
 * wherever a pin happened to be dropped, which makes them more accurate, not
 * less.
 *
 * It also removes the reverse-geocode round trip, the "use the pin's address"
 * button, and the geocode-never-answers hang those required a guard against.
 *
 * ── Absent-key behaviour is still the important part ─────────────────────
 * The component needs a key on a billed Google Cloud project with the Places
 * API enabled. This deployment may not have one, and a school profile form must
 * not stop working because of that. With no `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
 * this renders the plain text input the form has always had, plus one line
 * saying why there is no autocomplete.
 *
 * A key that is present and *rejected* is the harder case, and it is why
 * `gmpx-requesterror` is listened for: the element renders and accepts typing
 * whether or not the key works, so without that listener a blocked key would
 * look like a search that simply never finds anything. See STATE.md §5ai for
 * the three ways this failed when it was a map.
 *
 * ── The address stays free text ──────────────────────────────────────────
 * Autocomplete fills the field; it does not own it. Plenty of Pakistani school
 * addresses — a block and a sector, a landmark, a lane with no name — are not
 * what Places returns, and an operator must always be able to type over the
 * suggestion or ignore it entirely. The place is the assistance; the text is
 * the record.
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

type PickerState = 'absent' | 'loading' | 'ready' | 'failed';

/**
 * The custom elements, registered once per document.
 *
 * Module-level rather than per-component because `customElements.define` throws
 * on a second registration of the same tag, and two address fields on one page —
 * or one remounted by a re-render — would each try.
 *
 * Imported dynamically because these are browser-only: the modules touch
 * `window` and `customElements` at import time, which crashes a server render.
 */
let elementsRegistered: Promise<void> | null = null;

function registerElements(): Promise<void> {
  if (elementsRegistered !== null) return elementsRegistered;

  elementsRegistered = (async () => {
    await Promise.all([
      import('@googlemaps/extended-component-library/api_loader.js'),
      import('@googlemaps/extended-component-library/place_picker.js'),
    ]);
  })().catch((error: unknown) => {
    // Cleared so a later mount may retry: the usual cause is a chunk that
    // failed to download, which the next attempt resolves.
    elementsRegistered = null;
    throw error;
  });

  return elementsRegistered;
}

/** The `Place` fields this component reads. Narrower than what Places returns. */
interface SelectedPlace {
  formattedAddress?: string | null;
  displayName?: string | null;
  location?: { lat: () => number; lng: () => number } | null;
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

  const loaderRef = useRef<HTMLElement | null>(null);
  const pickerRef = useRef<HTMLElement | null>(null);

  const [state, setState] = useState<PickerState>(apiKey === '' ? 'absent' : 'loading');
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * `onChange` and the current value behind a ref.
   *
   * The place-change listener is attached once. Closing over `onChange`
   * directly would freeze the first render's copy, so a selection would write
   * onto a stale value and wipe whatever had been typed since. Re-attaching on
   * every render instead would rebind the listener on each keystroke.
   */
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  useEffect(() => {
    if (apiKey === '') return;

    let cancelled = false;
    // Captured here rather than read again in the cleanup: by teardown time the
    // ref may already point at a different node (or none), and the listeners
    // would be removed from the wrong element or not at all.
    let picker: HTMLElement | null = null;

    const handlePlaceChange = (event: Event) => {
      const place = (event.target as { value?: SelectedPlace | null } | null)?.value;

      // `undefined` means the operator cleared the input, `null` means Places
      // found nothing. Neither should wipe an address that was typed by hand,
      // so both are left alone — clearing the text is what clears the text.
      if (place === undefined || place === null) return;

      const current = latest.current;
      const address = place.formattedAddress ?? place.displayName ?? '';

      current.onChange({
        address: address === '' ? current.value.address : address,
        latitude: place.location?.lat() ?? null,
        longitude: place.location?.lng() ?? null,
      });
      setNotice(null);
    };

    const handleRequestError = () => {
      // The element renders and accepts typing whether or not the key works, so
      // a blocked key is otherwise indistinguishable from "no matches".
      if (!cancelled) setState('failed');
    };

    void (async () => {
      try {
        await registerElements();
        if (cancelled) return;

        // `key` is reserved in React and cannot be passed as a prop, so the API
        // key is assigned as a property on the element itself. This is the
        // arrangement Google documents for React.
        if (loaderRef.current !== null) {
          (loaderRef.current as unknown as { apiKey: string }).apiKey = apiKey;
        }

        picker = pickerRef.current;
        if (picker !== null) {
          // Pakistan only. An unrestricted autocomplete offers "Model Town,
          // Lahore" alongside identically named places in three other
          // countries, ordered by global traffic rather than by relevance to
          // anyone using this product.
          (picker as unknown as { country: string[] }).country = ['pk'];

          picker.addEventListener('gmpx-placechange', handlePlaceChange);
          picker.addEventListener('gmpx-requesterror', handleRequestError);
        }

        setState('ready');
      } catch {
        if (!cancelled) setState('failed');
      }
    })();

    return () => {
      cancelled = true;
      if (picker !== null) {
        picker.removeEventListener('gmpx-placechange', handlePlaceChange);
        picker.removeEventListener('gmpx-requesterror', handleRequestError);
      }
    };
    // Bound once, keyed only on the API key. `value` and `onChange` are read
    // through `latest` for the reason given there, so they are correctly absent
    // from the dependencies rather than suppressed.
  }, [apiKey]);

  const clearLocation = useCallback(() => {
    const current = latest.current;
    current.onChange({ ...current.value, latitude: null, longitude: null });
  }, []);

  const hasCoordinates = value.latitude !== null && value.longitude !== null;
  const degraded = state === 'absent' || state === 'failed';

  return (
    <div className={cn('w-full space-y-2', className)}>
      {/*
        The plain field is not a fallback rendered instead of the autocomplete —
        it is the field, always. The autocomplete sits above it and writes into
        it, so an operator can accept a suggestion and then edit the result, and
        so the form behaves identically when there is no key at all.
      */}
      {!degraded ? (
        <div className="w-full">
          <p className="mb-1.5 block text-sm font-medium text-ink">Search for the address</p>
          <gmpx-api-loader ref={loaderRef} solution-channel="GMP_QB_addressselection_v1" />
          <gmpx-place-picker
            ref={pickerRef}
            placeholder="Start typing a school, street or area…"
            className="block w-full"
            style={{
              // The element's own tokens, pointed at this product's. Left
              // unstyled it renders in Google's default blue-and-Roboto, which
              // is visibly not part of this form.
              '--gmpx-color-surface': 'rgb(var(--surface-raised))',
              '--gmpx-color-on-surface': 'rgb(var(--ink))',
              '--gmpx-color-primary': 'rgb(var(--brand-primary))',
              '--gmpx-font-family-base': 'inherit',
              width: '100%',
            } as React.CSSProperties}
          />
          <p className="mt-1.5 text-sm text-ink-muted">
            Pick a result to fill the address below and record its exact location.
            You can edit the address afterwards.
          </p>
        </div>
      ) : null}

      <Input
        label={label}
        value={value.address}
        onChange={(event) => {
          onChange({ ...value, address: event.target.value });
        }}
        disabled={disabled}
        error={error}
        hint={hint}
        placeholder="Plot 12, Block 6, PECHS, Karachi"
      />

      {degraded ? (
        <p className="text-xs text-ink-muted">
          {state === 'absent'
            ? 'Address search is off — no Google Maps key is configured for this deployment. The address above is still saved.'
            : 'Address search is unavailable, so the address above is being saved as typed. Check the Maps key’s billing and that the Places API is enabled.'}
        </p>
      ) : null}

      {hasCoordinates ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span className="font-mono tabular-nums">
            {value.latitude?.toFixed(5)}, {value.longitude?.toFixed(5)}
          </span>
          <button
            type="button"
            onClick={clearLocation}
            disabled={disabled}
            className="font-medium text-brand-primary hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
          >
            Clear the pinned location
          </button>
        </p>
      ) : null}

      {notice !== null ? <p className="text-xs text-status-warning-ink">{notice}</p> : null}
    </div>
  );
}
