# Release notes — panel chooser, school deletion, address autocomplete

**Date:** 2026-08-18
**Branch:** `claude/school-branch-creation-fixes-974895`
**Migration:** none — no schema change

Three requested changes, following the creation-form batch earlier the same
day. No database migration: everything here is UI, routing, or a swapped
dependency.

---

## 1. Super Admin can delete a school

`DELETE /api/super-admin/schools/[schoolId]` previously only ever set
`is_active = false`. Erasing a tenant meant SQL against production — unlogged,
unreviewed, and with nobody having checked what the cascade would actually do.

The route now takes `?permanent=true`, and the Schools table has a **Delete**
button on every row beside Deactivate.

**Deactivate remains the default and the unmarked path.** It is what an
operator wants almost every time — a school between sessions, or one that has
stopped paying — and it is reversible with one press. Permanent deletion is for
the cases deactivation cannot serve: a tenant created by mistake, a duplicate, a
test school on a live estate, or a school that has left and asked for its
records to be erased.

### What it removes

All 61 foreign keys pointing at `schools.location_id` are `ON DELETE CASCADE` —
verified against the schema, not assumed — so one statement takes the branches,
students, staff, enrolments, fee challans, payments, exams, results, payroll,
announcements and everything else. No residue, no orphans.

Supabase accounts are released too, but **only for members who belong to no
other school**. One Supabase account is one human: a parent with children at two
schools must not be locked out of the second because the first was deleted. This
had to be done *before* the delete, because afterwards there is no row left
saying which addresses belonged to the tenant — see `releaseSchoolAuthAccounts`.

### The confirmation is the school's own name

`confirmName` must match exactly, checked on the server as well as in the
dialog. A yes/no prompt is muscle memory by the third time an operator sees it;
typing the name cannot be done absent-mindedly, and — the part that matters —
cannot be done at all against the wrong row, which is the mistake worth
preventing on a screen listing every tenant on the platform.

The dialog spells out what is about to go, in specifics rather than "this cannot
be undone", which is a sentence people have learned to click past.

---

## 2. A panel chooser on the landing page

`schoolhub.codexmill.com` explained that schools live on subdomains and stopped
there. Anyone arriving at the apex — which is what people type — reached a dead
end, with no sign-in and no route to Super Admin unless they already knew the
`/super-admin/login` path.

It now offers the two things that can actually be done from there.

### What this deliberately does not do

**It does not offer eleven role buttons.** There are not eleven sign-in panels.
Every school role — administrator, principal, teacher, accountant, student,
parent — signs in at the *same* `/login`, on their own school's subdomain, with
the same email and password. Which panel they land on is decided by their
`school_users` row: `ROLE_HOME_ROUTES` sends a teacher to `/teacher` and a
parent to `/parent` the moment the session is minted.

So a menu of roles would be a menu of decisions that do not exist, and the first
person to pick "Teacher" and land somewhere labelled differently would
reasonably think it was broken. The roles are **listed**, so a visitor sees
their own panel named and knows they are in the right place, and the one
question that genuinely has to be answered is asked instead: **which school**.

That question is unavoidable — credentials are per-tenant, resolved from the
hostname by middleware, so a school user cannot sign in on the apex at all.
Super Admin is the exception, and is the other half of the screen: the platform
operator has no tenant, so their sign-in belongs there.

### Why the school is typed, not picked from a list

A dropdown of every school would serve the customer list to anyone who loads the
front page. Typing a subdomain discloses nothing: a wrong guess lands on
`/school-not-found`, exactly as a wrong guess at any URL already does.

On the platform domain the browser travels to `<slug>.<apex>/login`. Anywhere
else — localhost, a bare deployment host — it uses `/login?school=<slug>`, which
is the fallback middleware already supports. Same decision `buildHandoffUrl`
makes for the operator hand-off.

---

## 3. Address autocomplete replaces the map picker

`cyphercodes/location-picker` is removed. The address field now uses
`<gmpx-place-picker>` from Google's own
[`@googlemaps/extended-component-library`](https://github.com/googlemaps/extended-component-library).

**The map was the wrong instrument.** Entering a school's address is a *naming*
task, not a *pointing* task: the operator knows the address and wants to write
it down, and a map made them find a rooftop on a tile they had to pan and zoom
to reach. Autocomplete matches what they are actually doing — type "Beaconhouse
Johar Town", pick from four suggestions, and the address and its coordinates
arrive together.

Coordinates are still captured, and are now *more* accurate: they come from the
selected place rather than from wherever a pin happened to be dropped.

Predictions are restricted to Pakistan. Unrestricted, "Model Town, Lahore"
competes with identically named places in three other countries, ordered by
global traffic rather than by relevance to anyone using this product.

### What it removes along with the map

The reverse-geocode round trip, the "use the pin's address" button, and the
ten-second guard those needed — `Geocoder.geocode` never calls its callback when
the API is blocked, so a misconfigured key used to read as a frozen page.

### It still degrades

With no `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` the field is the plain text input it
has always been, plus one line saying why there is no search. A key that is
present and *rejected* is caught through `gmpx-requesterror`, because the
element renders and accepts typing whether or not the key works — without that
listener a blocked key would be indistinguishable from "no matches".

The address remains free text that autocomplete merely *fills*. Plenty of
Pakistani school addresses — a block and a sector, a landmark, a lane with no
name — are not what Places returns, and an operator must always be able to
overrule it.

**Still switched off in production.** The key supplied on 2026-08-18 is valid
but its project is unbilled and its API restrictions exclude the Maps
JavaScript API. Places API must also be enabled for autocomplete. See STATE.md
§6 item 11.

---

## Verification

Driven in a real browser this time — an operator session was already present, so
the screens behind the Super Admin gate could be exercised directly. This is the
click-through STATE.md §6 item 12 was asking for, now partly discharged.

**Landing page** — chooser renders; "Go to my school" → `abc-demo` → the school's
own branded ABC Demo login; a bogus slug → `/school-not-found`; "Super Admin
sign in" → the dashboard (already signed in).

**Dashboard chart** — confirmed visually. Every module name reads in full with
its value at the bar end. This was the original defect.

**School deletion** — exercised end to end on a throwaway `QA Delete Probe`
created for the purpose, never on an existing tenant:

| Step | Result |
|---|---|
| Create with landline, masked mobile, coordinates | all three persisted |
| `confirmName: "Wrong Name"` | `400 confirmation_required`, school untouched |
| `confirmName: "QA Delete Probe"` | `200`, deleted |
| Orphan check — branches, users, modules | 0, 0, 0 |
| Other schools | 9 before, 9 after |

The dialog's confirm button was verified `disabled: true` until the typed name
matches.

**Branch form** — City → Karachi auto-proposed `KHI-MAIN`; Mixed revealed the
board-name field; the class list re-filtered from Grade 9/10 to O1/O2/O3 on
switching to O-Levels, dropping the now-invalid tick and keeping the valid one;
a pasted `+92 321 1234567` masked to `(0321) 123-4567`; the address field showed
its no-key degradation.

**Automated** — `npm run check-forms` (60 assertions), `check-theme`,
`check-reports`, `check-dashboard`, `check-portals`, `check-provisioning`, plus
`tsc --noEmit`, `eslint` and a green `next build`.

### One correction worth recording

During QA the accessibility-tree reader showed no Delete button on any row, and
the first conclusion was that it had not rendered. Querying the DOM directly
found all nine. The tree view was eliding them; the application was correct. A
UI absence reported by one tool is worth confirming with a second before it is
treated as a defect.
