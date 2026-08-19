# Release notes — Response time, and a loader on every screen (2026-08-19)

**Status:** merged to `main`. **No migration.** Nothing to run.

> ⚠️ **This was not a sprint.** Sprint 13.5 (accounting) is still the next
> sprint and Sprint 14 is still internal chat. Nothing in here changes the
> schema or the database.

The platform felt slower. This is what was measured, what turned out to be
causing it, and what now stands between a click and the data.

---

## What was actually measured

34 timed requests against `https://schoolhub.codexmill.com`, splitting the TLS
handshake out of the wait so the number is the server's and not the network's:

| Page | Fast | Slow | Server time |
| --- | --- | --- | --- |
| `/` | 19 of 22 | 3 of 22 | ~85 ms vs ~1.02 s |
| `/school-not-found` | 9 of 12 | 3 of 12 | ~85 ms vs ~1.01 s |
| `/super-admin/login` | **0 of 12** | **12 of 12** | 0.82 – 1.23 s |

Every response carries `Server: hcdn` from an edge node in Kuala Lumpur, so the
split is not randomness: **~85 ms is Hostinger's CDN answering from its own
cache, and ~1 second is what it costs to reach the origin.**

### The finding that decided everything else

The **same production build**, run on a laptop:

| | Live origin | Same build, locally |
| --- | --- | --- |
| `/super-admin/login` | 0.82 – 1.23 s | **10 ms** |
| `/` | ~1.02 s on a cache miss | **4 ms** |

A hundredfold. And `/school-not-found` — a prerendered page that runs no code at
all — took the same ~1 second on a cache miss as the pages that do.

**So almost none of the second is the application.** It is the trip between the
CDN edge and the origin, paid in full on every request the edge cannot answer
from cache. Query batching, indexes and caching in the code were all checked and
were all already fine.

That leaves exactly two useful moves, and both were made.

---

## 1. Let the CDN answer more of it

The sign-in page for the platform panel read one query parameter — the
"where to go after signing in" — and reading it on the server made the whole
route dynamic, which made it uncacheable, which cost a full second on **every
single request** for a page with no database access at all.

That parameter is now read in the browser. The page is prerendered at build time
and served from the edge: **~1 s to ~85 ms.**

Making the page static was not enough on its own — the panel's shell layout
reads the operator's session, and a dynamic layout drags everything beneath it
dynamic too. The sign-in route now sits outside that shell, which is where it
always belonged: it was never rendered inside it.

Alongside that: modern browser targets, so the bundles stop carrying polyfills
for browsers nobody uses; compression stated explicitly rather than left to a
default; a year-long cache on hashed build assets; and production source maps
off. These are the items Hostinger's own diagnostics panel scored the site 0 and
50 on.

## 2. Never make a real person wait for the tenant lookup

Before any page renders, the request has to work out which school it is for.
That answer was cached for 60 seconds — but when the cache expired, **the next
person to click waited for the whole lookup**. Measured against the real
Supabase project: **3.5 seconds** cold, against 10 ms warm. It was always
somebody's click that paid it, never a background job's.

An expired answer is now used immediately and refreshed behind the request. Only
the very first lookup after a restart waits, and only once.

The cost, stated plainly: a school that is deactivated now stops being reachable
within 60 seconds **plus one request** instead of within 60 seconds. That is the
right way round — deactivation is an administrative action measured in minutes,
and it was never the thing keeping anyone out. Signing in is, and that check is
unchanged.

---

## What you will actually see: a loader on every screen

The rest of that second cannot be removed by code. Once you are signed in, your
pages are yours — they can never be cached at an edge, and the trip to the
origin is the trip to the origin.

So the change is that **you are no longer looking at nothing while it happens.**

**Every screen that loads data now shows its own shape while it loads.** Not a
spinner: an outline of the page that is coming — the table with its rows and
columns, the form with its fields, the record with its labels, the dashboard
with its figures and charts. 108 screens, each matched to what it becomes, so
nothing jumps when the real thing lands.

This is not cosmetic. The page frame now reaches the browser in **10 ms**
instead of after the full wait — measured on a school's sign-in page: first byte
at 10 ms, all the data in place at 1.27 s. Previously that was 1.27 seconds of
blank.

**A progress bar across the top of the window** covers the moment before even
that: the click itself, and the wait for the server to answer. It appears on
every navigation in the app — including the ones driven by buttons rather than
links, which is what a first attempt at this missed.

### It stays this way

`npm run check-loaders` refuses a build where any data-fetching screen is
missing its loader — including screens nobody has written yet. It also refuses
the two ways of getting it wrong that came up while doing this:

- a loader on a page that has nothing to wait for, which would flash fake
  content in front of content that had already arrived;
- a loader placed above a whole section rather than on a screen, which is a real
  bug that appeared during this work — the platform panel's skeleton rendered
  **permanently** above the sign-in form the moment that page became static.

The rule is written down in `CLAUDE.md` and is part of the definition of a green
build.

---

## Confirmed live

Measured after the deploy landed, not predicted.

**The platform sign-in page** went from **0 of 12 samples fast (0.82–1.23 s)** to
**10 of 10 at 86–91 ms**, and from 42,920 bytes to 9,910.

**A school's own sign-in page**, which can never be cached, now shows its shape
at ~900 ms and completes at ~2.0–2.2 s. It was blank for the whole of that
before.

Which gives the number that matters for everything from here:

| | |
| --- | --- |
| CDN cache hit | ~85 ms |
| **CDN edge → origin** | **~800–900 ms** |
| The application itself | ~10 ms |

A page that cannot be cached spends ~900 ms in transit and ~10 ms working. That
is the whole remaining problem, and no code change reaches it.

---

## Still outstanding, and not fixable from the code

**The ~1 second between Hostinger's CDN edge and the origin.** Proven above to
be transport, not application: a page that executes nothing pays it in full.
Worth checking in hPanel:

1. **Where the origin datacenter is.** If it is far from the Kuala Lumpur edge,
   that distance *is* the second.
2. **Whether the CDN helps at all for Pakistani traffic.** Lahore → Kuala Lumpur
   → origin may well be slower than Lahore → origin. It is one toggle and one
   afternoon of measurement.
3. **Whether more than one Node process is still running** (STATE.md §5ak). Two
   processes on a shared plan is double the memory and double the background
   workers for one core.

**The CDN's WAF returned 403 to a single IP after about 34 requests in three
minutes** during this measurement. A school office where thirty staff share one
connection could plausibly trip the same rule.
