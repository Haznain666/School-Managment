# Test cases — Address and phone fields

Traces to [`RELEASE-NOTES-ADDRESS-AND-PHONE-FIELDS.md`](../release-notes/RELEASE-NOTES-ADDRESS-AND-PHONE-FIELDS.md).
No migration.

**Run `npm run check-address-phone` first.** 32 assertions plus a scan of every
`.tsx` under `app/` and `components/` that fails on a raw `<Input label="Phone">`.
It covers the masks, the kind detection and the rollout, and it is faster than
any of the clicking below.

**The Mapbox coverage caveat governs half this file.** Mapbox has Pakistani
cities, districts and localities and very little else — "Model Town Lahore"
resolves, "Ferozepur Road" and "Beaconhouse" return nothing. **An empty
suggestion list is a normal state, not a fault**, and any case that treats it as
one is testing for the wrong behaviour.

---

## Phone masks

#### UC-APF-01 · Mobile is exactly eleven digits, grouped 4-3-4 — P1
**Role** Any · **Traces to** "Mobile `(0321) 123-4567` — exactly 11 digits"
1. Type `03211234567` into a Mobile field.
- **Expect** `(0321) 123-4567`, with the brackets appearing on their own.
2. Keep typing past eleven digits.
- **Expect** extra digits are dropped, not rejected — "holding a key down cannot produce a value the field would refuse."

#### UC-APF-02 · Landline is a 3-digit area code then up to ten digits — P1
**Role** Any · **Traces to** "Landline `(021) 3456789` — 3-digit area code, then up to 10 digits"
1. Type `0213456789` into a Landline field.
- **Expect** `(021) 3456789`.
2. Type more than thirteen digits.
- **Expect** capped at area code + 10.

#### UC-APF-03 · Digits only — letters and symbols are discarded as typed — P1
**Role** Any · **Traces to** "**Digits only, in both.** Letters, `+`, spaces, dashes and brackets typed by hand are discarded as you type"
1. Type `03ab00+12*34#567xyz` into a Mobile field.
- **Expect** `(0300) 123-4567`.
- **Fail** if any non-digit survives, or if the field rejects rather than filtering.

#### UC-APF-04 · A pasted `+92` number is rewritten, not refused — P1
**Role** Any · **Traces to** "A number pasted from a contact card as `+92 321 1234567` lands correctly as `(0321) 123-4567` instead of being refused"
1. Paste `+92 321 1234567`.
- **Expect** `(0321) 123-4567`.
- **Fail** on rejection — this is how a number arrives from a contact card or a WhatsApp export.

#### UC-APF-05 · Switching the dropdown re-masks the digits already typed — P2
**Role** Any · **Traces to** "Switching the dropdown re-writes the digits already typed under the other mask, so changing your mind costs nothing"
1. Type a full mobile, then switch to Landline, then back.
- **Expect** digits survive each switch, re-masked; nothing is silently blanked.

#### UC-APF-06 · The right digits in the wrong shape are still refused — P1
**Role** API client · **Traces to** the format being "a specification, not a preference"
1. POST `0321-1234567` — eleven correct digits, wrong shape.
- **Expect** refused. The mask is enforced on the server too.

---

## The eleven-digit landline defect

#### UC-APF-07 · `042 35300000` is a landline, not a mobile — P1
**Role** Any · **Traces to** "`042 35300000` is a Lahore landline. It has eleven digits, and the old mobile check accepted any eleven digits beginning with a zero — so it was treated as a mobile and rewritten as `(0423) 530-0000`, a number that does not exist, derived from one that does"
1. Load a record holding `(042) 35300000`.
- **Expect** the dropdown reads **Landline** and the value is unchanged.
- **Fail** on `(0423) 530-0000`. Every Pakistani mobile begins `03`, and this was live from migration `0024` until it was fixed.

#### UC-APF-08 · A stored number survives being reloaded — P1 · **AUTOMATED**
**Role** Any · **Traces to** the round-trip assertion: store → detect → re-mask → identical
1. For `(0321) 123-4567`, `(021) 3456789` and `(042) 35300000`: open the form and close it without saving.
- **Expect** all three unchanged.
- **Fail** on any rewrite — "a failure there silently rewrites data on load rather than throwing."

---

## Identity phones

#### UC-APF-09 · Landline is offered on identity fields and then refused, with a reason — P1
**Role** School administrator · **Traces to** "Those fields still show the dropdown, but choosing Landline is refused, with a line saying why"
1. On the guardian phone, invitation phone and admissions application phone: switch to Landline with a value present.
- **Expect** the dropdown still offers it; the field is invalid, `aria-invalid="true"`, with a message explaining the number identifies the person.
- **Fail** if Landline is hidden — "a guardian who has only a landline cannot be reached by the platform, and the form now says so at the moment it matters."

#### UC-APF-10 · A masked mobile still reaches the identity path — P1
**Role** School administrator · **Traces to** "a mobile written in this module's display format is accepted by `normalizePhone`, whose first act is to strip spaces, dashes and parentheses"
1. Save a guardian with `(0321) 123-4567`. Read the stored value.
- **Expect** it normalises to `+923211234567`.
- **Fail** if the brackets reach `normalizePhone` unstripped and the save is refused.

---

## Address autocomplete

#### UC-APF-11 · Suggestions appear and fill the field — P2
**Role** Super Admin · **Traces to** "Pick a result and the address is filled in"
1. Type `Model Town Lahore` into an address field.
- **Expect** a suggestion list; picking it writes `Model Town, Lahore, لاہور, Punjab, Pakistan`.

#### UC-APF-12 · Coordinates are captured, latitude first — P1
**Role** Super Admin · **Traces to** "the exact location is stored alongside and shown under the field"
1. Pick Model Town, Lahore. Read the coordinates.
- **Expect** `31.48511, 74.32620` — latitude then longitude.
- **Fail** on reversed order. GeoJSON is `[lng, lat]`, and reversing it "puts every school in the sea off Somalia".

#### UC-APF-13 · Results are restricted to Pakistan — P2
**Role** Super Admin · **Traces to** the country restriction carried over from the Google picker
1. Search for a place name that exists in several countries.
- **Expect** only Pakistani results.

#### UC-APF-14 · An empty suggestion list is normal, not an error — P1
**Role** Super Admin · **Traces to** "**that is normal, not a fault**… an empty result list is worded plainly ('type the address in full'), never as an error"
1. Type `Ferozepur Road` and `Beaconhouse Johar Town`.
- **Expect** no useful suggestion, wording that invites typing, and a fully usable text field.
- **Fail** if it reads as a failure, or if the field becomes unusable. Most real school addresses land here.

#### UC-APF-15 · The text field is always there and always editable — P1
**Role** Super Admin · **Traces to** "the box is an ordinary text field first and a search second — it is always there, always editable, and never replaced by the results list"
1. Type an address Mapbox does not know and save it.
2. Pick a suggestion, then edit the result by hand.
- **Expect** both work.

#### UC-APF-16 · Editing the address drops the stored location — P1
**Role** Super Admin · **Traces to** "If a suggestion is picked and the address is then edited to something else, the stored location is dropped rather than left behind — otherwise the record would keep the map pin of a place it no longer names"
1. Pick Model Town (pin appears). Type a different address over it.
- **Expect** the pin is dropped.
- **Fail** if it persists — saving would file the new address at the old location, silently, with nothing on screen contradicting it.

#### UC-APF-17 · Address search is on every address field — P2
**Role** Super Admin, school administrator · **Traces to** "It now runs on the school profile page and the staff record too"
1. Open the school form, branch form, school profile page and staff record.
- **Expect** all four search.

#### UC-APF-18 · Fields with nowhere to store a location show no pin — P2
**Role** School administrator · **Traces to** the staff record and school profile having no `latitude`/`longitude`
1. Pick a suggestion on the staff address and the school profile address.
- **Expect** the address fills; **no coordinates are offered**.
- **Fail** if a pin is shown that the form cannot save — it would read as data loss on the next Save.

---

## Degradation and configuration

#### UC-APF-19 · With no token the field is a plain text box that says why — P1
**Role** Operator · **Traces to** "Until it is, every address field is the plain text box it has always been and says so in one line — nothing breaks and no address is lost"
1. With `NEXT_PUBLIC_MAPBOX_TOKEN` unset, open every address field and save one.
- **Expect** every field still saves; one line explains the absence.
- **Fail** if any form breaks. "A school profile form must not stop working because a third-party account has lapsed."

> **This is the live state, not a hypothetical.** The committed fallback was
> removed after GitHub push protection refused it (STATE.md §5ao), so until the
> panel variable is set this case describes what a school actually sees. **Run
> it first** — it is the only address case that passes with no token, and the
> six above it will all fail until one is configured.

#### UC-APF-20 · A rejected token is distinguishable from "no matches" — P1
**Role** Operator · **Traces to** "the input accepts typing either way, so a blocked token is otherwise indistinguishable from 'no matches'"
1. Set an invalid token, or restrict it to exclude this origin.
- **Expect** a message naming the token and its URL restrictions — different from the no-match wording of UC-APF-14.

#### UC-APF-21 · `NEXT_PUBLIC_MAPBOX_TOKEN` is the only source — P1
**Role** Operator · **Traces to** "**Address search needs `NEXT_PUBLIC_MAPBOX_TOKEN` set in the hosting panel.**… There is no committed fallback"
1. Grep the repository for a `pk.` literal.
- **Expect** none — the fallback was removed and its absence is the point.
2. Set the variable in the panel, rebuild, and confirm requests carry it.
- **Expect** address search comes to life.
- **Note** it is read at **build** time, so setting it without a rebuild changes nothing. That is the same trap `NEXT_PUBLIC_SUPABASE_ANON_KEY` carries (STATE.md §5d item 2).

#### UC-APF-22 · Google is gone — P3
**Role** Operator · **Traces to** "`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is no longer read and can be removed"
1. Grep for `@googlemaps`, `gmpx-` and the Google key.
- **Expect** no runtime reference.

---

## Billing

#### UC-APF-23 · Keystrokes are debounced into few requests — P1
**Role** Operator · **Traces to** the verification: "two full address entries (46 characters typed) produced **2 suggest calls and 1 retrieve**"
1. Type two full addresses, picking one. Count requests to `api.mapbox.com`.
- **Expect** a small number of suggest calls, not one per keystroke.
- **Fail** on per-keystroke billing — "invisible until the invoice arrived."

#### UC-APF-24 · One session token per edit, rotated after a retrieve — P1
**Role** Operator · **Traces to** the Search Box session model
1. Inspect `session_token` across the requests from UC-APF-23.
- **Expect** one token shared across an edit's suggest calls, and a fresh one after a retrieve.
- **Fail** if every keystroke carries a new token — each then bills as its own session.

---

## Existing data

#### UC-APF-25 · Nothing is rewritten until a record is saved — P1
**Role** School administrator · **Traces to** "Numbers already stored are re-displayed under the correct mask when a form is next opened, and are only rewritten if the record is saved"
1. Open a record with an unmasked legacy number; close without saving. Check the database.
- **Expect** unchanged.
2. Save it.
- **Expect** now normalised.
