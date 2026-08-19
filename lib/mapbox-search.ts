/**
 * Mapbox Search Box client, for the address fields.
 *
 * ── Why this replaced Google Places ──────────────────────────────────────
 * The address field was `<gmpx-place-picker>` from Google's Extended Component
 * Library. It is now Mapbox, on a `pk.` token supplied for this deployment.
 * The behaviour the old component was built around is kept exactly: the
 * autocomplete *assists* the field, it does not own it. See
 * `components/ui/AddressAutocomplete.tsx` for why that matters here.
 *
 * ── Why plain `fetch` and not a Mapbox SDK ───────────────────────────────
 * Two endpoints, four fields read from each. A search SDK would add a package,
 * a custom element and a second styling system to a form that already has one,
 * which is the problem the Google component library caused. There is nothing
 * here a `fetch` does not do.
 *
 * ── suggest → retrieve, and the session token ────────────────────────────
 * Search Box is a two-call API on purpose. `suggest` answers keystrokes and is
 * cheap; `retrieve` resolves one chosen suggestion to coordinates and is
 * billed. They are joined by a **session token**: every keystroke in one
 * editing session must carry the same token, and a new one is minted after a
 * retrieve. Get that wrong and each keystroke bills as its own session — the
 * single most expensive mistake available in this file, and invisible until
 * the invoice arrives.
 *
 * ── Coverage is thin in Pakistan, and that is load-bearing ───────────────
 * Mapbox has cities, districts and localities for Pakistan but very few
 * streets and almost no POIs: "Model Town Lahore" resolves, "Ferozepur Road"
 * and "Beaconhouse" return nothing at all. So the suggestion list is expected
 * to be empty for a large share of real school addresses, and an empty list is
 * a normal state rather than an error. Nothing in the UI may treat "no
 * suggestions" as a failure, and the typed text must always stand on its own.
 */

/** A place, as far as the address field is concerned. */
export interface AddressSuggestion {
  /** Opaque Search Box id; the only thing `retrieveAddress` accepts. */
  id: string;
  /** The place's own name, e.g. "Model Town". */
  name: string;
  /** Where it sits, e.g. "Lahore, Punjab, Pakistan". Empty when unknown. */
  context: string;
}

/** A retrieved place: the text to write into the field, and where it is. */
export interface RetrievedAddress {
  address: string;
  latitude: number | null;
  longitude: number | null;
}

const SUGGEST_URL = 'https://api.mapbox.com/search/searchbox/v1/suggest';
const RETRIEVE_URL = 'https://api.mapbox.com/search/searchbox/v1/retrieve';

/**
 * Pakistan only.
 *
 * An unrestricted search offers "Model Town, Lahore" alongside identically
 * named places in three other countries, ordered by global traffic rather than
 * by relevance to anyone using this product. This is the same restriction the
 * Google picker carried, and for the same reason.
 */
const COUNTRY = 'pk';

/**
 * Everything from a country down to a street address.
 *
 * Spelled out rather than left to the default because the default omits the
 * administrative types, and in Pakistan those are most of what Mapbox actually
 * has. Dropping them would leave the field returning nothing for nearly every
 * query.
 */
const TYPES = [
  'country',
  'region',
  'district',
  'postcode',
  'place',
  'locality',
  'neighborhood',
  'street',
  'address',
  'poi',
].join(',');

/** Short enough that the list feels live, long enough not to bill every key. */
export const SUGGEST_DEBOUNCE_MS = 250;

/** Below this a query matches half the country; Search Box rejects 1 char. */
export const MIN_QUERY_LENGTH = 3;

/**
 * A fresh session token.
 *
 * `crypto.randomUUID` is unavailable on insecure origins in some browsers, and
 * an address field must not throw because the page is being served over plain
 * HTTP on a LAN. The fallback is not cryptographic and does not need to be —
 * Mapbox only requires that the value be unique per session.
 */
export function newSessionToken(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoRef?.randomUUID === 'function') return cryptoRef.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Raised for any answer that is not a usable result. */
export class MapboxSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapboxSearchError';
  }
}

interface SuggestResponse {
  suggestions?: {
    mapbox_id?: string;
    name?: string;
    place_formatted?: string;
    full_address?: string;
  }[];
}

interface RetrieveResponse {
  features?: {
    geometry?: { coordinates?: unknown };
    properties?: {
      name?: string;
      full_address?: string;
      place_formatted?: string;
    };
  }[];
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // 401 and 403 are the two that matter and they mean different things: a
    // rejected token, and a token whose URL restrictions exclude this origin.
    // Both surface to the operator as "search is unavailable" — the difference
    // is for whoever reads the console.
    throw new MapboxSearchError(`Mapbox responded ${String(response.status)}.`);
  }
  return (await response.json()) as T;
}

/**
 * Suggestions for a partial query.
 *
 * Returns an empty array for a query that is too short, rather than throwing or
 * calling out — the caller renders "no matches" for both, and a two-character
 * query is not an error condition.
 *
 * @param signal aborts an in-flight request when a later keystroke supersedes
 *   it. Without it the answers to two keystrokes can arrive out of order and
 *   the older one wins, which shows suggestions for a prefix of what is on
 *   screen.
 */
export async function suggestAddresses(options: {
  query: string;
  token: string;
  sessionToken: string;
  signal?: AbortSignal;
}): Promise<AddressSuggestion[]> {
  const query = options.query.trim();
  if (query.length < MIN_QUERY_LENGTH || options.token === '') return [];

  const url = new URL(SUGGEST_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('access_token', options.token);
  url.searchParams.set('session_token', options.sessionToken);
  url.searchParams.set('country', COUNTRY);
  url.searchParams.set('types', TYPES);
  url.searchParams.set('language', 'en');
  url.searchParams.set('limit', '6');

  const body = await readJson<SuggestResponse>(
    await fetch(url, { signal: options.signal }),
  );

  return (body.suggestions ?? [])
    .map((item) => ({
      id: item.mapbox_id ?? '',
      name: item.name ?? '',
      // `full_address` is present for street addresses and POIs and is the
      // better line; `place_formatted` is what administrative results carry.
      context: item.full_address ?? item.place_formatted ?? '',
    }))
    .filter((item) => item.id !== '' && item.name !== '');
}

/**
 * Resolves a chosen suggestion to the text and the coordinates.
 *
 * The address preferred is `full_address`, which already contains the name —
 * "Model Town, Lahore, Punjab, Pakistan". Where Mapbox has no full address the
 * name and its context are joined by hand, so an administrative result still
 * writes something an envelope could carry rather than the bare word "Lahore".
 */
export async function retrieveAddress(options: {
  id: string;
  token: string;
  sessionToken: string;
  signal?: AbortSignal;
}): Promise<RetrievedAddress> {
  const url = new URL(`${RETRIEVE_URL}/${encodeURIComponent(options.id)}`);
  url.searchParams.set('access_token', options.token);
  url.searchParams.set('session_token', options.sessionToken);

  const body = await readJson<RetrieveResponse>(
    await fetch(url, { signal: options.signal }),
  );

  const feature = body.features?.[0];
  if (feature === undefined) {
    throw new MapboxSearchError('Mapbox returned no feature for that place.');
  }

  const properties = feature.properties ?? {};
  const name = properties.name ?? '';
  const place = properties.place_formatted ?? '';

  const address =
    properties.full_address ??
    [name, place].filter((part) => part !== '').join(', ');

  // GeoJSON order is [longitude, latitude] and reversing it puts every school
  // in the ocean off Somalia. Validated rather than trusted: a feature type
  // without a point geometry would otherwise store `undefined` as a number.
  const coordinates = feature.geometry?.coordinates;
  const hasPoint =
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    typeof coordinates[0] === 'number' &&
    typeof coordinates[1] === 'number';

  return {
    address,
    latitude: hasPoint ? (coordinates[1] as number) : null,
    longitude: hasPoint ? (coordinates[0] as number) : null,
  };
}
