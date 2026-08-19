'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { publicEnv } from '@/lib/env';
import {
  MIN_QUERY_LENGTH,
  SUGGEST_DEBOUNCE_MS,
  newSessionToken,
  retrieveAddress,
  suggestAddresses,
  type AddressSuggestion,
} from '@/lib/mapbox-search';
import { cn } from '@/lib/utils';

/**
 * The address field. **Every address input in this product is this component.**
 *
 * ── What replaced what ───────────────────────────────────────────────────
 * First a draggable pin on a Google map (`cyphercodes/location-picker`), then
 * Google's `<gmpx-place-picker>`, now Mapbox Search Box. The reasoning that
 * retired the map still holds and is worth keeping: entering a school's address
 * is a *naming* task, not a *pointing* task. The operator knows the address and
 * wants to write it down; a map made them find a rooftop on a tile they had to
 * pan and zoom to reach.
 *
 * The move from Google to Mapbox is a change of supplier, not of behaviour.
 * This renders the product's own `Input`/`Textarea` and its own listbox rather
 * than a vendor custom element, which is a real gain: the old component had to
 * be re-skinned through `--gmpx-*` variables and still rendered in Roboto.
 *
 * ── The address stays free text, and here that is essential ──────────────
 * Autocomplete fills the field; it does not own it. This was already true with
 * Google. With Mapbox it is *load-bearing*, because Mapbox's Pakistani data is
 * cities, districts and localities and very little else — "Model Town Lahore"
 * resolves, "Ferozepur Road" and "Beaconhouse" return nothing at all. Most real
 * school addresses will therefore produce no suggestion, and the operator will
 * simply type. That is a supported outcome, not a degraded one:
 *
 *   - an empty suggestion list is never styled or worded as an error;
 *   - the text input is always present and always editable, never replaced by
 *     the suggestion list, and never disabled while a request is in flight;
 *   - choosing a suggestion writes into the field and then gets out of the way.
 *
 * ── Absent-token behaviour ───────────────────────────────────────────────
 * With no `NEXT_PUBLIC_MAPBOX_TOKEN` and no committed fallback this is the
 * plain field the form has always had, plus one line saying why there is no
 * search. A school profile form must not stop working because a third-party
 * account has lapsed. A token that is present and *rejected* is the harder
 * case and is why the fetch failure is surfaced rather than swallowed: the
 * input accepts typing either way, so a blocked token is otherwise
 * indistinguishable from "no matches".
 */

export interface LocationValue {
  address: string;
  latitude: number | null;
  longitude: number | null;
}

export interface AddressAutocompleteProps {
  label?: string;
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  disabled?: boolean;
  error?: string;
  hint?: string;
  placeholder?: string;
  className?: string;
  /**
   * Whether this address has somewhere to put coordinates.
   *
   * `false` for the records whose table has no `latitude`/`longitude` — a staff
   * member's home address, for one. The search still helps them type it; there
   * is simply no point showing a pinned location the form cannot save, which
   * would read as data loss the moment they pressed Save.
   */
  withCoordinates?: boolean;
  /** Renders a `Textarea` instead of an `Input`, for the multi-line fields. */
  multiline?: boolean;
  /** Rows for the textarea. Ignored unless `multiline`. */
  rows?: number;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; suggestions: AddressSuggestion[] }
  | { status: 'failed' };

const DEFAULT_PLACEHOLDER = 'Plot 12, Block 6, PECHS, Karachi';

export function AddressAutocomplete({
  label = 'Address',
  value,
  onChange,
  disabled = false,
  error,
  hint,
  placeholder = DEFAULT_PLACEHOLDER,
  className,
  withCoordinates = true,
  multiline = false,
  rows = 2,
}: AddressAutocompleteProps) {
  const token = publicEnv.mapboxToken;
  const hasToken = token !== '';

  const listboxId = useId();
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  /**
   * The Search Box session, held across every keystroke of one edit and rotated
   * after a retrieve. Suggest calls that share a session are billed as one
   * search; a fresh token per keystroke would bill each one separately. See
   * `lib/mapbox-search.ts`.
   */
  const sessionRef = useRef<string>(newSessionToken());

  /**
   * The query the suggestions belong to, and the value/handler behind a ref.
   *
   * `onChange` is read through a ref for the same reason the Google version
   * did: the debounce and the abort controller are set up per keystroke but the
   * selection handler must always write onto the *current* value, not the one
   * captured when the timer was armed.
   */
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  /**
   * The text the operator typed, as distinct from `value.address`.
   *
   * They are the same string almost always. They diverge for exactly one
   * moment: a suggestion is chosen, `value.address` becomes the full formatted
   * address, and the query that produced the list is now stale. Searching again
   * on that write would reopen the list under the operator's cursor immediately
   * after they picked something, which is the classic autocomplete loop.
   */
  const queryRef = useRef(value.address);
  /** Set while a selection is being applied, to suppress exactly that. */
  const selectingRef = useRef(false);

  /**
   * The exact text the last successful retrieve wrote.
   *
   * Coordinates belong to *that* string and to no other. Once the operator
   * edits away from it the pin is describing somewhere the address no longer
   * names, and saving would file the new address at the old place's location —
   * silently, because nothing on screen contradicts it. So the text is kept
   * here and compared on every keystroke; see `write`.
   *
   * Initialised from the incoming value so that a record loaded with
   * coordinates already stored does not lose them on first paint.
   */
  const retrievedAddressRef = useRef(value.address);

  const [notice, setNotice] = useState<string | null>(null);

  const query = value.address;

  useEffect(() => {
    if (!hasToken || disabled) return;

    if (selectingRef.current) {
      selectingRef.current = false;
      queryRef.current = query;
      return;
    }
    queryRef.current = query;

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSearch({ status: 'idle' });
      setOpen(false);
      return;
    }

    const controller = new AbortController();
    setSearch({ status: 'searching' });

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const suggestions = await suggestAddresses({
            query: trimmed,
            token,
            sessionToken: sessionRef.current,
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          setSearch({ status: 'done', suggestions });
          setActiveIndex(-1);
          setOpen(true);
        } catch (caught: unknown) {
          // An abort is the expected end of a superseded keystroke, not a
          // failure, and must not paint the field as broken.
          if (controller.signal.aborted) return;
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          setSearch({ status: 'failed' });
          setOpen(false);
        }
      })();
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, token, hasToken, disabled]);

  const select = useCallback(
    (suggestion: AddressSuggestion) => {
      const session = sessionRef.current;
      selectingRef.current = true;
      setOpen(false);
      setActiveIndex(-1);
      setNotice(null);

      void (async () => {
        try {
          const retrieved = await retrieveAddress({
            id: suggestion.id,
            token,
            sessionToken: session,
          });

          const current = latest.current;
          // A retrieve that somehow yields no text must not blank a field the
          // operator has already typed into.
          const address =
            retrieved.address === '' ? current.value.address : retrieved.address;

          retrievedAddressRef.current = address;
          current.onChange({
            address,
            latitude: withCoordinates ? retrieved.latitude : null,
            longitude: withCoordinates ? retrieved.longitude : null,
          });
        } catch {
          // The name is still better than nothing, and the operator chose it.
          // Falling back to it means a failed retrieve costs the coordinates,
          // not the selection.
          const current = latest.current;
          selectingRef.current = true;
          const address = [suggestion.name, suggestion.context]
            .filter((part) => part !== '')
            .join(', ');

          // No coordinates were obtained, so nothing may claim this text has
          // any — including a pin left over from an earlier selection.
          retrievedAddressRef.current = '';
          current.onChange({
            address,
            latitude: null,
            longitude: null,
          });
          setNotice('That place was chosen, but its exact location could not be fetched.');
        } finally {
          // One retrieve ends the session it belonged to. The next keystroke
          // starts a new one.
          sessionRef.current = newSessionToken();
        }
      })();
    },
    [token, withCoordinates],
  );

  const suggestions = search.status === 'done' ? search.suggestions : [];
  const listOpen = open && hasToken && !disabled && suggestions.length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!listOpen) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      // Only swallowed when something is highlighted, so Enter still submits
      // the form when the list is merely open.
      event.preventDefault();
      const chosen = suggestions[activeIndex];
      if (chosen !== undefined) select(chosen);
    }
  };

  const write = (next: string) => {
    const pinBelongsToThisText = next === retrievedAddressRef.current;

    onChange({
      address: next,
      // Cleared rather than kept: coordinates that describe a different place
      // than the text are worse than no coordinates at all, because a map drawn
      // from them looks authoritative and is wrong. Picking a suggestion again
      // restores them.
      latitude: pinBelongsToThisText ? value.latitude : null,
      longitude: pinBelongsToThisText ? value.longitude : null,
    });
  };

  const shared = {
    label,
    value: value.address,
    disabled,
    error,
    hint,
    placeholder,
    onKeyDown: handleKeyDown,
    // The listbox is a sibling of the field rather than a child, so blur must
    // not close it before the option's click lands. A frame's delay is enough
    // and is why this is a timeout rather than a `relatedTarget` check, which
    // is unreliable when the option is reached by touch.
    onBlur: () => {
      setTimeout(() => {
        setOpen(false);
      }, 150);
    },
    onFocus: () => {
      if (suggestions.length > 0) setOpen(true);
    },
    role: 'combobox' as const,
    'aria-expanded': listOpen,
    'aria-controls': listboxId,
    'aria-autocomplete': 'list' as const,
    'aria-activedescendant':
      activeIndex >= 0 ? `${listboxId}-option-${String(activeIndex)}` : undefined,
    autoComplete: 'off',
  };

  const hasCoordinates =
    withCoordinates && value.latitude !== null && value.longitude !== null;

  const clearLocation = () => {
    onChange({ ...value, latitude: null, longitude: null });
  };

  return (
    <div className={cn('w-full', className)}>
      <div className="relative">
        {multiline ? (
          <Textarea
            {...shared}
            rows={rows}
            onChange={(event) => {
              write(event.target.value);
            }}
          />
        ) : (
          <Input
            {...shared}
            onChange={(event) => {
              write(event.target.value);
            }}
          />
        )}

        {listOpen ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Address suggestions"
            className={cn(
              'absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line-strong',
              'bg-surface-raised py-1 shadow-lg',
            )}
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                id={`${listboxId}-option-${String(index)}`}
                role="option"
                aria-selected={index === activeIndex}
              >
                <button
                  type="button"
                  // `onMouseDown` rather than `onClick`: the field's blur fires
                  // first on a click, and preventing the default here keeps the
                  // caret in the input so the operator can keep editing.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    select(suggestion);
                  }}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                  className={cn(
                    'block w-full px-3 py-2 text-left text-sm',
                    index === activeIndex ? 'bg-surface-sunken text-ink' : 'text-ink',
                  )}
                >
                  <span className="block font-medium">{suggestion.name}</span>
                  {suggestion.context !== '' ? (
                    <span className="block text-xs text-ink-muted">
                      {suggestion.context}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/*
        One line under the field, and only one. The states it distinguishes are
        the ones an operator can act on: no token (tell an administrator), a
        rejected token (tell an administrator, differently), and a search that
        found nothing (keep typing — which is the common case in Pakistan and is
        therefore worded as ordinary rather than as a miss).
      */}
      {!hasToken ? (
        <p className="mt-1.5 text-xs text-ink-muted">
          Address search is off — no Mapbox token is configured for this
          deployment. The address above is still saved exactly as typed.
        </p>
      ) : search.status === 'failed' ? (
        <p className="mt-1.5 text-xs text-status-warning-ink">
          Address search is unavailable, so the address is being saved as typed.
          Check the Mapbox token and its URL restrictions.
        </p>
      ) : search.status === 'done' &&
        suggestions.length === 0 &&
        value.address.trim().length >= MIN_QUERY_LENGTH ? (
        <p className="mt-1.5 text-xs text-ink-muted">
          No match in Mapbox for that — type the address in full. Coverage of
          Pakistani streets is patchy, so this is expected as often as not.
        </p>
      ) : hint === undefined && error === undefined ? (
        <p className="mt-1.5 text-xs text-ink-muted">
          Start typing to search, or write the address out in full.
        </p>
      ) : null}

      {hasCoordinates ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
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

      {notice !== null ? (
        <p className="mt-1.5 text-xs text-status-warning-ink">{notice}</p>
      ) : null}
    </div>
  );
}
