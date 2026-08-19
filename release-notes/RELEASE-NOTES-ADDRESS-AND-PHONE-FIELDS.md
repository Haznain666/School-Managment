# Address and phone fields — one shape, everywhere

**2026-08-19. No migration.**

Two kinds of field appear on almost every form a school fills in: an address and
a phone number. Until now each screen implemented them its own way. A guardian's
phone was an empty box that accepted anything at all; the school's phone was a
different empty box; the branch form had two masked fields that were correct; the
address on the school form searched Google Places and the address on the staff
record did not search anything.

They are now one field each, used everywhere.

---

## The phone field

Every phone input has a **Mobile / Landline** dropdown beside it that decides
how the number is written:

| Kind | Format | Length |
| --- | --- | --- |
| Mobile | `(0321) 123-4567` | exactly 11 digits |
| Landline | `(021) 3456789` | 3-digit area code, then up to 10 digits |

**Digits only, in both.** Letters, `+`, spaces, dashes and brackets typed by hand
are discarded as you type rather than rejected when you save — the brackets and
the dash appear on their own, so nobody has to be told where they go. A number
pasted from a contact card as `+92 321 1234567` lands correctly as
`(0321) 123-4567` instead of being refused.

Switching the dropdown re-writes the digits already typed under the other mask,
so changing your mind costs nothing.

### One thing the dropdown cannot do

Some numbers on this platform are not contact details — they identify a person.
A guardian's number is how the school's records tell one guardian from another,
how an invitation finds them, and where a sign-in code is sent. **Those fields
still show the dropdown, but choosing Landline is refused, with a line saying
why.** A guardian who has only a landline cannot be reached by the platform, and
the form now says so at the moment it matters rather than failing on save.

Fields affected: guardian phone (admissions and the student record), the
invitation phone, and the admissions application phone.

### A wrong number that used to be accepted

`042 35300000` is a Lahore landline. It has eleven digits, and the old mobile
check accepted any eleven digits beginning with a zero — so it was treated as a
mobile and rewritten as `(0423) 530-0000`, a number that does not exist, derived
from one that does. Every Pakistani mobile begins `03`, and the check now says
so. Existing records display under the correct mask again.

---

## The address field

Every address input now completes as you type, against **Mapbox**. Pick a result
and the address is filled in; where the record has room for it, the exact
location is stored alongside and shown under the field, with a link to clear it.

Address search previously ran on Google Places and only on the school and branch
forms. It now runs on the school profile page and the staff record too, and the
Google dependency is gone.

### Coverage — please read this one

**Mapbox knows Pakistani cities, districts and localities well, and Pakistani
streets and buildings barely at all.** "Model Town, Lahore" is found.
"Ferozepur Road" and "Beaconhouse Johar Town" return nothing.

So for a large share of real school addresses there will be **no suggestion, and
that is normal, not a fault**. The field is built around it:

- the box is an ordinary text field first and a search second — it is always
  there, always editable, and never replaced by the results list;
- an empty result list is worded plainly ("type the address in full"), never as
  an error;
- anything picked from the list can be edited afterwards.

If a suggestion is picked and the address is then edited to something else, the
stored location is dropped rather than left behind — otherwise the record would
keep the map pin of a place it no longer names.

---

## What a school administrator should do

Nothing. No settings to change, no data to re-enter. Numbers already stored are
re-displayed under the correct mask when a form is next opened, and are only
rewritten if the record is saved.

## What the platform administrator should know

- Address search runs on a Mapbox token that ships with the application, so it
  works without anything being configured. To use a different one, set
  `NEXT_PUBLIC_MAPBOX_TOKEN`. Restrict the token by URL in the Mapbox console —
  it is served to browsers, which is normal for this kind of token, and the URL
  restriction is what protects the account.
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is no longer read and can be removed.
- With no token at all, every address field keeps working as a plain text box
  and says why there is no search.
