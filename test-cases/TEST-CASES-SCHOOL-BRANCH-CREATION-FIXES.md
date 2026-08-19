# Test cases — School and branch creation, fixed

Traces to [`RELEASE-NOTES-SCHOOL-BRANCH-CREATION-FIXES.md`](../release-notes/RELEASE-NOTES-SCHOOL-BRANCH-CREATION-FIXES.md).
Migration `0024`, applied. **Not a sprint** — a batch of fixes to the Sprint 2
and 3 creation forms, plus two account defects found while looking at them.

**Every rule here is enforced twice**, in the browser and again on the server,
from the same code. So **every validation case below has two halves**: click it,
then post the same bad value directly. "A form is not a gate — a request posted
directly never runs the browser's code."

Much of this is covered by `npm run check-forms` (60 assertions). Run it first;
it is faster than clicking and it caught a real gap in the mobile validator.

> **Two parts of this note are superseded.** The map picker was replaced by
> Google Place Autocomplete the same day, and then by Mapbox — see the
> address-and-phone cases. Do not test for *Find on map* or *Use the pin's
> address*; both are gone.

---

## The dashboard chart

#### UC-SBC-01 · Module names read in full — P2 · **SUPERSEDED**
**Traces to** "eleven module names… every label ran across its neighbours until the axis was a single smear"
- The module-adoption chart was **removed** in the next release and replaced by
  two compact charts. Test UC-DDE-01/02 instead. Kept here so the original
  defect is not re-tested against a chart that no longer exists.

#### UC-SBC-02 · Horizontal bars are still used where labels are long — P3 · **AUTOMATED**
**Traces to** "Rotating the labels replaces overlap with a wall of diagonal text. Truncating them renders 'Academics & Timetable' and 'Accounts & Finance' as the same string — which is worse than overlapping, because it looks correct"
1. Run `npm run check-forms`, which asserts the chart geometry — "no two category labels share a baseline".
2. Anywhere a long-labelled comparison chart is added, confirm it is horizontal.

---

## Adding a branch

#### UC-SBC-03 · City is asked first and proposes the code — P2
**Role** Super Admin · **Traces to** "The city is asked first because it is the only answer that produces another one. Choose Karachi and the branch code fills in as `KHI-MAIN`"
1. Open the branch form. Confirm the field order is city, name, code.
2. Choose Karachi.
- **Expect** the code fills in as `KHI-MAIN`.

#### UC-SBC-04 · The proposed code is a suggestion, not a rule — P2
**Role** Super Admin · **Traces to** "type over it and it stops following the city"
1. Type over the code, then change the city.
- **Expect** the typed code stands.
- **Fail** if changing the city overwrites a deliberate edit.

#### UC-SBC-05 · The branch name is never guessed — P3
**Role** Super Admin · **Traces to** "'Johar Town Campus' is not derivable from anything, and a guess would only have to be cleared"
1. Choose a city.
- **Expect** the name stays empty.

#### UC-SBC-06 · Mixed demands a board name — P1 · both halves
**Role** Super Admin · **Traces to** "'Mixed' on its own cannot be printed on a certificate or answered in a report"
1. Choose *Mixed*; confirm a board-name field appears; try to save without it.
2. POST the same without a board name.
- **Expect** refused both ways.

#### UC-SBC-07 · Classes are ticked from a curriculum-filtered list — P1
**Role** Super Admin · **Traces to** the replacement of "Highest grade", which "could not express a junior campus, which has a floor as well as a ceiling; a campus that skips a year; the difference between `Grade 10`, `10`, `Class X` and `Matric`"
1. Confirm the list runs Pre-School–Grade 8 for every campus, then: **Grade 9/10** for Matric and Mixed, **O1/O2/O3** for O Levels, **O1/O2/O3/AS/A2** for A Levels.
2. Declare a junior campus with a floor and a ceiling, and one that skips a year.
- **Expect** both expressible. *Select all* exists for the full ladder.

#### UC-SBC-08 · Changing the curriculum drops only the invalid ticks — P1
**Role** Super Admin · **Traces to** "the classes the new curriculum does not have are dropped, and the rest are kept. That is a correction, not an error"
1. Tick Grade 8 and Grade 9 under Matric. Switch to O Levels.
- **Expect** Grade 9 is dropped, Grade 8 kept, no error shown.
- **Fail** if everything is cleared, or if an error is raised — "it is what an operator who just changed the curriculum meant."

#### UC-SBC-09 · Landline and mobile are separate masked fields — P1 · both halves
**Role** Super Admin · **Traces to** "A landline, `(021) 3456789`, and a mobile, `(0321) 123-4567`. Both format themselves as you type"
1. Type into each and watch the brackets appear.
2. Paste `+92 321 1234567` into mobile.
- **Expect** it is rewritten to `(0321) 123-4567`, not rejected — "which is how it arrives from a contact card".
3. POST a badly shaped number to the route.
- **Expect** refused. See the address-and-phone cases for the full mask suite, including the `042 35300000` defect.

#### UC-SBC-10 · Email is checked against the real rule — P1 · both halves
**Role** Super Admin · **Traces to** "That is what catches `admin@school`, which is the mistake people genuinely make and which the form used to accept happily"
1. Enter `admin@school`.
- **Expect** refused, with a message that **names the problem** and suggests `school.com` rather than saying "invalid".
2. POST it directly.
- **Expect** refused.

#### UC-SBC-11 · Address search assists a field that stays free text — P1
**Role** Super Admin · **Traces to** "The address is still a **text field** that the map merely assists… the operator must always be able to overrule the machine"
- Superseded in mechanism, not in principle. Test via UC-APF-09 onward.

---

## Adding a school

#### UC-SBC-12 · The same rules apply on the school form — P1
**Role** Super Admin · **Traces to** "city asked first, landline and mobile as separate masked fields, email checked against the real standard"
1. Repeat UC-SBC-03, 09 and 10 on the school form.

#### UC-SBC-13 · Curriculum, board and classes are **not** on the school form — P2
**Role** Super Admin · **Traces to** "they are not facts about a school. Two campuses of one school routinely run different boards, which is why they live on the branch"
1. Open the school form.
- **Expect** none of the three present.
- **Fail** if they are — a school-level curriculum contradicts the branch-level one the moment a second campus differs.

#### UC-SBC-14 · A bad school code does not strand the form — P2
**Role** Super Admin · **Traces to** "entering a bad school code used to leave the form disabled with its spinner running and no way out but a page reload"
1. Enter an invalid school code and submit.
- **Expect** an error and a usable form.
- **Fail** if the spinner runs forever.

---

## Enforced twice

#### UC-SBC-15 · Every rule holds against a direct request — P1
**Role** API client · **Traces to** "the likelier reason this matters is not an attacker but the next thing that talks to these routes: a bulk import, a script, a screen nobody has built yet"
1. POST to the school and branch routes violating each rule above in turn.
- **Expect** refused every time.

#### UC-SBC-16 · `npm run check-forms` passes — P1 · **AUTOMATED**
**Role** Developer · **Traces to** "`npm run check-forms` asserts all of it, 60 checks, including the chart geometry. It caught two things during this work, one of which was a genuine gap in the mobile validator"
1. Run it.
- **Expect** 60 assertions, all green.

---

## Supabase account registration

#### UC-SBC-17 · The typed address reaches Supabase immediately — P1
**Role** Super Admin · **Traces to** "**The defect was what was missing.** Not one address that the panel had actually been asked to invite was in Supabase at all"
1. Create an administrator. Check Supabase at once.
- **Expect** the address is there.
- **Fail** if only `pa_…@…` synthetic addresses exist. That was the exact report, and those synthetic accounts are legitimate — see UC-S02-06.

#### UC-SBC-18 · A duplicate or typo is refused on the form — P1
**Role** Super Admin · **Traces to** "refused while the operator is still on the form, rather than surfacing days later when the recipient clicks a link"
1. Create with an address already registered.
- **Expect** refused immediately, on the form.

#### UC-SBC-19 · Registered still means "Invite pending" — P1
**Role** Super Admin · See UC-S03-06. All three dependent behaviours must still be correct: setup link vs sign-in reminder, "Invite pending" in the list, and emergency-link issuance.

---

## Deleting a user

#### UC-SBC-20 · A deleted member cannot return on their old password — P1
**Role** School administrator · **Traces to** "**Someone removed for cause could sign in again the moment they were re-added.**"
1. Delete a member, re-invite the same address.
- **Expect** they must set a new password.

#### UC-SBC-21 · Deleting at one school does not lock them out of another — P1 · **NEEDS TENANCY**
**Role** School administrator · **Traces to** "One Supabase account is one *person*, not one membership… Deleting it any sooner would lock somebody out of a school that had done nothing, and would do it invisibly"
1. Delete a member who is also a member elsewhere. Sign in at the other school.
- **Expect** unaffected.
- **Fail** silently-and-invisibly is the risk here; verify by actually signing in, not by reading a screen.

---

## Migration safety

#### UC-SBC-22 · Nothing existing was disturbed — P1
**Role** Operator, database · **Traces to** "Migration `0024` adds eight columns and drops none. Every one is nullable or defaulted"
1. Confirm eight columns added, none dropped, and no existing row's behaviour changed.
2. Confirm `max_grade` is **kept and still populated** on the two branches that have it — its values "cannot be converted into the new class list without guessing".
3. Confirm existing phone numbers were **not** rewritten by the migration; they normalise "the next time the record is saved".
- **Fail** if any phone number changed in place. "Reformatting contact details for every tenant inside a migration is not a thing to do quietly."
