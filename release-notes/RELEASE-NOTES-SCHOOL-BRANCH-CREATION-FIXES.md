# Release notes — School and branch creation, fixed

**Status:** merged to `main`. **Migration `0024_school_branch_creation_fixes.sql`
is applied** to the live database and verified against the real schema.

**This is not a sprint.** It is a batch of fixes to the screens Sprints 2 and 3
built — the Super Admin's school and branch creation forms — plus two defects in
how accounts reach Supabase that were found while looking at them. Sprint 13.5
(accounting) is still the next sprint, and Sprint 14 is still internal chat.

One item on the list turned out to be two separate bugs wearing one description,
and they are the most important things here. They are last, because they are the
ones worth reading slowly.

---

## The dashboard chart was unreadable

Eleven module names were being drawn along the bottom of the module-adoption
chart, each with about 54 units of width to live in. "Admissions & Enrolment"
does not fit in 54 units, so every label ran across its neighbours until the
axis was a single smear of overlapping words.

The chart now runs **horizontally**: module names down the left, bars growing
rightwards, and each bar's figure printed at its end. A label now gets a column
of fixed width instead of a share of the axis, so it fits however long it is.

Two easier fixes were tried on paper and rejected. Rotating the labels replaces
overlap with a wall of diagonal text. Truncating them renders "Academics &
Timetable" and "Accounts & Finance" as the same string — which is worse than
overlapping, because it looks correct.

Charts elsewhere in the product are unchanged. They are time series and
short-labelled comparisons, which is what a vertical bar chart is for.

---

## Adding a branch

**The questions are in a new order: city, then name, then code.**

The city is asked first because it is the only answer that produces another one.
Choose Karachi and the branch code fills in as `KHI-MAIN`, so an operator working
down the form finds the third field already done. It is a suggestion, not a rule
— type over it and it stops following the city.

The branch name sits between them and stays empty. It is the one thing only the
school knows; "Johar Town Campus" is not derivable from anything, and a guess
would only have to be cleared.

**A mixed-board campus now says which boards.** Choosing *Mixed* reveals a board
name field and will not save without it. "Mixed" on its own cannot be printed on
a certificate or answered in a report.

**"Highest grade" is gone, replaced by a list of classes to tick.** The old field
was a single free-text box, and it could not express:

- a junior campus, which has a floor as well as a ceiling;
- a campus that skips a year;
- the difference between `Grade 10`, `10`, `Class X` and `Matric`, all of which
  were valid answers and none of which were comparable to each other.

The tick list runs Pre-School through Grade 8 for every campus, then follows the
curriculum: **Grade 9 and Grade 10** for Matric and Mixed, **O1/O2/O3** for
O Levels, **O1/O2/O3/AS/A2** for A Levels. There is a *Select all* for the common
case of a campus teaching the whole ladder.

Change the curriculum after ticking and the classes the new curriculum does not
have are dropped, and the rest are kept. That is a correction, not an error — it
is what an operator who just changed the curriculum meant.

**One phone field became two.** A landline, `(021) 3456789`, and a mobile,
`(0321) 123-4567`. Both format themselves as you type, so nobody has to be told
where the brackets go, and a number pasted as `+92 321 1234567` — which is how it
arrives from a contact card — is rewritten rather than rejected.

**Email is checked properly.** Against the rule mail providers actually apply,
not against "does it contain an @". That is what catches `admin@school`, which
is the mistake people genuinely make and which the form used to accept happily.
The message names the problem: it suggests `school.com` rather than saying
"invalid".

**The address has a map.** Type an address and press *Find on map*, or drag the
pin and press *Use the pin's address*. The exact position is saved alongside the
text.

> The address is still a **text field** that the map merely assists. A great many
> Pakistani school addresses — a block and a sector, a lane with no name, a
> landmark — are not what a geocoder returns, and the operator must always be
> able to overrule the machine.

> **The map needs a Google Maps key**, and this deployment does not have one yet.
> Until `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set the address is exactly the plain
> text field it always was, with one line saying why there is no map. Nothing
> breaks and nothing is lost. See `.env.example`.

---

## Adding a school

The same rules, on the same reasoning: city asked first, landline and mobile as
separate masked fields, email checked against the real standard, and the map
picker on the address.

Curriculum, board name and classes are **not** on the school form, because they
are not facts about a school. Two campuses of one school routinely run different
boards, which is why they live on the branch.

Also fixed while in there: entering a bad school code used to leave the form
disabled with its spinner running and no way out but a page reload.

---

## Every rule is enforced twice

Each rule above is checked in the browser *and* again on the server, from the
same code. A form is not a gate — a request posted directly never runs the
browser's code — and the likelier reason this matters is not an attacker but the
next thing that talks to these routes: a bulk import, a script, a screen nobody
has built yet.

`npm run check-forms` asserts all of it, 60 checks, including the chart geometry.
It caught two things during this work, one of which was a genuine gap in the
mobile validator.

---

## Supabase held none of the real addresses

The report was that mail was going somewhere invalid, with a screenshot of
Supabase showing five accounts, all of them looking like
`pa_29bf6094…@schoolhub.codexmill.com`.

Those synthetic addresses are real and are supposed to exist — they are the
accounts behind the Super Admin's "Login as Admin" hand-off, one per school, and
nobody ever reads mail at them. **The defect was what was missing.** Not one
address that the panel had actually been asked to invite was in Supabase at all,
because nothing created an account when an administrator was provisioned. The
account only appeared later, at the moment that person set their password —
which, for anyone who had not yet done so, was never.

So an operator checking Supabase to confirm where an invitation had gone found
only addresses the platform had invented, and none of the ones they had typed.

**The address is now registered with Supabase the moment an administrator is
created.** A typo or a duplicate is refused while the operator is still on the
form, rather than surfacing days later when the recipient clicks a link.

What deliberately has *not* changed: the person is still not marked as having an
account until they set a password. That flag decides whether they get a setup
link or a "here is where to sign in" reminder, whether the members list shows
"Invite pending", and whether an emergency link can be issued. Marking someone
established the moment their address is registered would make all of those say
something untrue.

> **Mail delivery itself is a separate, still-open problem.** SMTP is failing in
> production with `535 5.7.8`, so invitations are queued and not sent regardless
> of which address they are addressed to. That is `SMTP_USER`/`SMTP_PASS` in the
> hosting panel and is not fixed here. See `STATE.md` §5ah.

---

## Deleting a user left them able to come back

Deleting a member removed their `school_users` row, which ended their access and
looked, from every screen, like a complete removal.

It was not. The Supabase account survived, and Supabase addresses are globally
unique — so that address stayed claimed forever, and re-inviting the same person
put them straight back onto the old account, inheriting its password. **Someone
removed for cause could sign in again the moment they were re-added.**

The account is now deleted along with the membership.

> **With one check first, and it matters.** One Supabase account is one *person*,
> not one membership — that is what lets the same address be a teacher at one
> school and a parent at another. So the account is only deleted once no other
> school still lists that address. Deleting it any sooner would lock somebody out
> of a school that had done nothing, and would do it invisibly.

---

## Nothing existing was disturbed

Migration `0024` adds eight columns and drops none. Every one is nullable or
defaulted, so no existing row changes behaviour and no back-fill was needed.

`max_grade` — the column behind the old "Highest grade" box — is **kept and left
populated**, though nothing reads or writes it any more. Its values cannot be
converted into the new class list without guessing: `Grade 10`, `10`, `O2` and
`Matric` were all valid answers to that box, and guessing wrong would silently
mis-declare a campus. Two branches currently have a value in it. Their classes
show as not yet declared until somebody who can ask sets them.

Existing phone numbers are **not** rewritten. Whatever is stored is what somebody
entered, and reformatting contact details for every tenant inside a migration is
not a thing to do quietly. They are normalised the next time the record is saved.
