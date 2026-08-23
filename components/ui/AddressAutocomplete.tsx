'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

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
 *
 * ── Why the suggestion list is portalled to `<body>` ─────────────────────
 * `Card` sets `overflow-hidden` — that is what clips a table's corners to the
 * card radius, and removing it regresses every screen that relies on it. An
 * absolutely-positioned listbox inside a card is therefore clipped at the card
 * border, and an address field sits near the *bottom* of almost every card in
 * this product, so the common case was a list sliced in half: the operator
 * could see the top of "Gulshan-e-Iqbal" and could not read or reliably click
 * it.
 *
 * A portal to `document.body` escapes every ancestor's overflow at once, which
 * no amount of z-index can do — `overflow: hidden` clips a descendant whatever
 * its stacking order. The cost is that the list is no longer a DOM sibling of
 * the field, so three things it used to get for free are now explicit:
 *
 *   1. **Position.** Fixed coordinates measured from the control's bounding
 *      rect, re-measured on scroll (capture phase, so an inner scrolling
 *      container counts) and on resize.
 *   2. **Dismissal.** `onBlur` used to close after a timeout on the assumption
 *      that a click on an option was a click on a sibling. It now asks whether
 *      focus moved *into the list*, and a document-level `pointerdown` closes
 *      the list when the press lands outside both.
 *   3. **The accessibility tree.** `aria-controls` still names the listbox and
 *      `aria-activedescendant` still names the option, which is all the ARIA
 *      contract requires — ids are document-wide, not subtree-wide. `aria-owns`
 *      is added so assistive technology that walks the DOM still sees the list
 *      as belonging to the combobox.
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

/** Where the portalled listbox sits, in viewport coordinates. */
interface ListboxPlacement {
  left: number;
  width: number;
  /** Set when the list hangs below the field. */
  top?: number;
  /** Set instead of `top` when it has been flipped above. */
  bottom?: number;
  maxHeight: number;
}

/** Breathing room between the control and the list. */
const LIST_GAP_PX = 4;
/** The old `max-h-64`, kept so the flip does not change how tall the list is. */
const MAX_LIST_HEIGHT_PX = 256;
/** Below this, "below the field" is not somewhere a list can usefully go. */
const MIN_LIST_HEIGHT_PX = 160;

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

  /* -- The portalled listbox: mounting, measuring, dismissing ---------------- */

  /**
   * `document` exists only after mount, and this component renders on the
   * server like every other. The portal is therefore created on the second
   * render and never during the first — which costs nothing, because a list
   * with no suggestions in it is not rendered on the first render either.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  /** The wrapper around the control. One control inside it, always. */
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const [placement, setPlacement] = useState<ListboxPlacement | null>(null);

  const measure = useCallback(() => {
    const control = fieldRef.current?.querySelector('input, textarea');
    if (control === null || control === undefined) return;

    const rect = control.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - LIST_GAP_PX;
    const spaceAbove = rect.top - LIST_GAP_PX;

    // Flip only when below genuinely cannot hold a usable list *and* above is
    // roomier. Flipping on a marginal difference makes the list jump around as
    // the page scrolls, which is worse than a slightly short list.
    const flip = spaceBelow < MIN_LIST_HEIGHT_PX && spaceAbove > spaceBelow;

    setPlacement({
      left: rect.left,
      width: rect.width,
      top: flip ? undefined : rect.bottom + LIST_GAP_PX,
      bottom: flip ? window.innerHeight - rect.top + LIST_GAP_PX : undefined,
      maxHeight: Math.min(MAX_LIST_HEIGHT_PX, flip ? spaceAbove : spaceBelow),
    });
  }, []);

  useEffect(() => {
    if (!listOpen) {
      setPlacement(null);
      return;
    }

    measure();

    // Capture phase: a scroll inside a modal body or any other scrolling
    // ancestor does not bubble to `window`, and that is precisely where a form
    // long enough to need this component tends to live.
    const reposition = () => {
      measure();
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [listOpen, suggestions.length, measure]);

  useEffect(() => {
    if (!listOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (fieldRef.current?.contains(target) === true) return;
      if (listRef.current?.contains(target) === true) return;
      setOpen(false);
      setActiveIndex(-1);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [listOpen]);

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
    /*
     * The listbox is portalled to `<body>`, so "focus left the field" no longer
     * implies "focus left the widget". It was a timeout before, on the reasoning
     * that a click on an option would land within a frame or two — which is
     * true for a mouse and is a race for anything slower.
     *
     * Two mechanisms replace it, and neither is timing-dependent: focus moving
     * *into* the list keeps the list open, and a press anywhere outside both the
     * field and the list closes it (the `pointerdown` listener above). Between
     * them, an option is selectable by mouse, by touch and by keyboard, and the
     * list still shuts when the operator tabs away.
     */
    onBlur: (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && listRef.current?.contains(next) === true) return;
      setOpen(false);
    },
    onFocus: () => {
      if (suggestions.length > 0) setOpen(true);
    },
    role: 'combobox' as const,
    'aria-expanded': listOpen,
    'aria-controls': listboxId,
    // The list is not a descendant of the combobox any more. `aria-owns` puts
    // it back in the accessibility tree where the DOM no longer does.
    'aria-owns': listOpen ? listboxId : undefined,
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
      <div className="relative" ref={fieldRef}>
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

        {listOpen && mounted && placement !== null
          ? createPortal(
              <ul
                id={listboxId}
                ref={listRef}
                role="listbox"
                aria-label="Address suggestions"
                style={{
                  position: 'fixed',
                  left: placement.left,
                  width: placement.width,
                  top: placement.top,
                  bottom: placement.bottom,
                  maxHeight: placement.maxHeight,
                }}
                className={cn(
                  // `z-modal` rather than `z-dropdown`: portalled to `<body>`,
                  // this list is a sibling of any dialog on the page rather
                  // than a descendant of it, so at dropdown level it would
                  // render *behind* a modal that owns the field it belongs to.
                  'z-modal overflow-auto rounded-lg border border-line-strong',
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
                      // `onMouseDown` rather than `onClick`: the field's blur
                      // fires first on a click, and preventing the default here
                      // keeps the caret in the input so the operator can keep
                      // editing. It also means the field never loses focus, so
                      // the portal has not changed what this handler has to do.
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
              </ul>,
              document.body,
            )
          : null}
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
