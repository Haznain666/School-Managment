'use client';

import { Loader2, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import { Icon } from '@/components/ui/Icon';
import {
  MIN_QUERY_LENGTH,
  PREVIEW_HITS_PER_GROUP,
  type SearchGroup,
  type SearchResults,
} from '@/lib/search-types';
import { cn } from '@/lib/utils';

/**
 * The search box in every portal's header.
 *
 * ── What this is, and what the results page is ───────────────────────────
 * This is the *preview*: the three best hits per category, close enough to the
 * keystroke to feel like the box is answering. The product owner's requirement
 * is that a search lands on a page, and it does — Enter, or "See all results",
 * goes to `resultsHref`. The dropdown is not a second, lesser results screen;
 * it is the shortcut for the case where the answer is already visible, which is
 * most of them.
 *
 * ── Debounced, aborted, and ordered ──────────────────────────────────────
 * Three separate problems that look like one:
 *
 * 1. **Debounce** — 250ms after the last keystroke. Without it, typing a
 *    six-letter name is six ILIKE sweeps over five tables.
 * 2. **Abort** — the previous request is cancelled when a new one starts, so a
 *    slow reply cannot arrive after a fast one and repaint the box with results
 *    for a prefix the person has already typed past. On a deployment with a ~1s
 *    edge hop (§5aq) that is not a theoretical race; it is what happens.
 * 3. **Ownership** — the response is dropped unless the query it was issued for
 *    is still what the box contains. Abort covers the common case; this covers
 *    the one where the request had already completed on the wire.
 *
 * ── Keyboard ─────────────────────────────────────────────────────────────
 * `/` and ⌘K focus it from anywhere, which is what anyone who uses a CRM daily
 * will reach for; `/` is skipped while a field is focused, or it would be
 * impossible to type a slash. Up/Down walk the hits, Enter opens the highlighted
 * one or goes to the results page, Escape closes.
 */

export interface GlobalSearchProps {
  /** `/api/school/search` or `/api/super-admin/search`. */
  endpoint: string;
  /** Where Enter goes — `/dashboard/search`, `/super-admin/search`, … */
  resultsHref: string;
  placeholder?: string;
  /**
   * Painted for a brand-coloured header (the four school portals) or for the
   * platform's neutral one. Two surfaces, two contrast problems: on a school's
   * `primary` the box has to be a tint of the foreground, and on the platform's
   * `surface-raised` it has to be an ordinary bordered field.
   */
  tone?: 'brand' | 'neutral';
  className?: string;
}

interface ApiEnvelope {
  ok: boolean;
  data?: SearchResults;
}

const DEBOUNCE_MS = 250;

export function GlobalSearch({
  endpoint,
  resultsHref,
  placeholder = 'Search…',
  tone = 'brand',
  className,
}: GlobalSearchProps) {
  const router = useRouter();
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();
  const searchable = trimmed.length >= MIN_QUERY_LENGTH;

  /** The preview's hits, flattened, so arrow keys have one list to walk. */
  const flat = useMemo(() => {
    if (results === null) return [];
    return results.groups.flatMap((group) =>
      group.hits.slice(0, PREVIEW_HITS_PER_GROUP).map((hit) => hit.href),
    );
  }, [results]);

  useEffect(() => {
    if (!searchable) {
      abortRef.current?.abort();
      setResults(null);
      setPending(false);
      return;
    }

    setPending(true);

    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        try {
          const response = await fetch(
            `${endpoint}?q=${encodeURIComponent(trimmed)}`,
            { signal: controller.signal },
          );
          const payload = (await response.json()) as ApiEnvelope;

          // Ownership check. `abort` handles the in-flight case; this handles
          // the one where the reply had already left before the keystroke.
          if (payload.ok && payload.data?.query === trimmed) {
            setResults(payload.data);
            setActive(-1);
          }
        } catch {
          // An abort is the expected path here, and a genuine network failure
          // is indistinguishable from it at this level. Either way the box
          // keeps whatever it had rather than flashing an error at somebody
          // who is still typing; the results page reports failures properly.
        } finally {
          if (!controller.signal.aborted) setPending(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [endpoint, trimmed, searchable]);

  // Clicking anywhere else closes the panel. Pointerdown rather than click, so
  // it closes before a link underneath it receives the press.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // `/` and ⌘K from anywhere. `/` is skipped while a field is focused, or a
  // slash could never be typed into any form in the product.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      const shortcut =
        (event.key === 'k' && (event.metaKey || event.ctrlKey)) ||
        (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey);

      if (shortcut) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const goToResults = useCallback(() => {
    if (!searchable) return;
    setOpen(false);
    inputRef.current?.blur();
    router.push(`${resultsHref}?q=${encodeURIComponent(trimmed)}`);
  }, [resultsHref, router, searchable, trimmed]);

  const onSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const href = active >= 0 ? flat[active] : undefined;

      if (href !== undefined) {
        setOpen(false);
        inputRef.current?.blur();
        router.push(href);
        return;
      }

      goToResults();
    },
    [active, flat, goToResults, router],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setActive(-1);
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (flat.length === 0) return;
        event.preventDefault();
        setOpen(true);
        setActive((current) => {
          const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
          if (next < 0) return flat.length - 1;
          if (next >= flat.length) return 0;
          return next;
        });
      }
    },
    [flat.length],
  );

  const showPanel = open && searchable;
  const groups = results?.groups ?? [];

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <form role="search" onSubmit={onSubmit}>
        <label htmlFor={inputId} className="sr-only">
          Search
        </label>

        <div className="relative">
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2',
              tone === 'brand' ? 'text-brand-onPrimary/70' : 'text-ink-muted',
            )}
          >
            <Icon as={pending ? Loader2 : Search} size="sm" className={pending ? 'animate-spin' : undefined} />
          </span>

          <input
            id={inputId}
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={listboxId}
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            placeholder={placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            className={cn(
              'w-full rounded-control border py-1.5 pl-8 pr-8 text-sm transition-colors duration-fast',
              // `appearance-none` kills WebKit's own clear button, which
              // duplicates ours and sits under it.
              '[&::-webkit-search-cancel-button]:appearance-none',
              tone === 'brand'
                ? 'border-brand-onPrimary/25 bg-brand-onPrimary/10 text-brand-onPrimary placeholder:text-brand-onPrimary/60 focus:border-brand-onPrimary/50'
                : 'border-line-strong bg-surface text-ink placeholder:text-ink-muted focus:border-brand-primary',
            )}
          />

          {query === '' ? null : (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults(null);
                setActive(-1);
                inputRef.current?.focus();
              }}
              className={cn(
                'absolute right-1.5 top-1/2 -translate-y-1/2 rounded-control p-1',
                tone === 'brand'
                  ? 'text-brand-onPrimary/70 hover:bg-brand-onPrimary/15'
                  : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
              )}
            >
              <Icon as={X} size="sm" label="Clear search" />
            </button>
          )}
        </div>
      </form>

      {showPanel ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          /*
           * `absolute` inside a `relative` wrapper, and the wrapper is in the
           * header — which is a flex row with nothing clipping it. §5az records
           * an autocomplete list being eaten by the card around it; this one is
           * checked against the same trap, and the header has no
           * `overflow-hidden` anywhere in its ancestry.
           */
          className="absolute left-0 right-0 top-full z-dropdown mt-2 max-h-[70vh] w-full min-w-[20rem] overflow-y-auto rounded-card border border-line bg-surface-raised text-ink shadow-modal sm:left-auto sm:w-[28rem]"
        >
          {pending && results === null ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">Searching…</p>
          ) : groups.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">
              Nothing matches “{trimmed}”.
            </p>
          ) : (
            <>
              {groups.map((group) => (
                <PreviewGroup
                  key={group.key}
                  group={group}
                  activeHref={active >= 0 ? flat[active] : undefined}
                  onNavigate={() => {
                    setOpen(false);
                  }}
                />
              ))}
            </>
          )}

          <button
            type="button"
            onClick={goToResults}
            className="block w-full border-t border-line bg-surface-sunken px-4 py-2.5 text-left text-sm font-medium text-brand-primaryInk hover:bg-surface-hover"
          >
            {results === null || results.total === 0
              ? `Search everything for “${trimmed}”`
              : `See all results for “${trimmed}”`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PreviewGroup({
  group,
  activeHref,
  onNavigate,
}: {
  group: SearchGroup;
  activeHref: string | undefined;
  onNavigate: () => void;
}) {
  return (
    <div className="border-b border-line last:border-b-0">
      <p className="bg-surface-sunken px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {group.label}
      </p>

      <ul>
        {group.hits.slice(0, PREVIEW_HITS_PER_GROUP).map((hit) => (
          <li key={hit.key}>
            <Link
              href={hit.href}
              onClick={onNavigate}
              role="option"
              aria-selected={hit.href === activeHref}
              className={cn(
                'flex items-baseline justify-between gap-3 px-4 py-2 text-sm hover:bg-surface-hover',
                hit.href === activeHref && 'bg-surface-hover',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{hit.title}</span>
                {hit.subtitle === null ? null : (
                  <span className="block truncate text-xs text-ink-muted">
                    {hit.subtitle}
                  </span>
                )}
              </span>

              {/*
                The screen the hit lives on, always. This is the part most
                global searches leave out, and it is what turns three rows all
                reading "Ahmed Raza" from a puzzle into an answer.
              */}
              <span className="shrink-0 text-xs text-ink-faint">{hit.page}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
