# Sprint 28 — the child nobody billed, and the CNIC that stopped looking

**Branch:** `claude/enrollment-fee-cnic-fixes-c152bb`
**Migration:** `0044_admission_voucher_permission.sql` — **applied** (bookkeeping 44 → 45)
**Merged:** `51b3d52` (PR #67)

---

## What this sprint is

Two defects, reported by the product owner against Askari School System in one
sentence each, and a third found while proving the first. No new feature. Every
line of it exists because a real child at a real school was admitted and never
billed, and four screens agreed that nothing was wrong.

---

## 1. A head can admit a child, and could not bill one

**The report:** *"I enrolled a new student 50 in askari school system. I did not
pay his fee yet his fee appears to be cleared, I didn't see any option to
generate his fee voucher like it used to be before."*

Principal, Branch Administrator and Vice Principal all hold `admissions.write`
and `students.create` — enrolling a child is their job. None of them holds
`fees.write`, deliberately: that key also sets the price list and records
payments, and keeping it away from a head is the same control the accounting
module draws when it keeps `accounting.settle` away from the person who counts
the cash.

But **raising the admission voucher cost `fees.write` too**. So the three roles
that admit children were the three that could not bill one. The panel on the
child's profile rendered *Not yet billed*, the amount, and then nothing — no
button, and no sentence saying why there was no button. The clerk who had just
admitted the child had no next step and no way to know one existed.

Student 50 (`ASST-2026-0004`, Pre-Nursery B) was admitted by a Principal into a
grade priced at **PKR 35,000** and had no voucher of any kind.

**`fees.admission` is the fix, and it is deliberately narrow.** *Raise a
student's admission voucher* — one voucher, for one child, at an amount the
server resolves from the fee structure. It grants nothing over the price list
and nothing over taking money. Held by default by Branch Administrator,
Principal, Vice Principal and Accountant, and grantable to anybody else on the
Roles & Permissions screen.

*Confirm the fee was paid* stays on `fees.write`. Recording money taken across a
desk is still a money action, and the two are now separable — which is the point.

**And where the permission is absent, the card now says so**, naming the
permission and who can grant it. A card that offers nothing and explains nothing
is what shipped; a reader with no next step concludes the screen is broken.

## 2. That child then wore a green chip reading *Cleared*

The fee chip on the student directory had four states, and the fourth was
reached by falling off the end of the ranking: no open voucher, therefore
nothing outstanding, therefore green.

A child admitted five minutes ago has no open voucher either. **They owe nothing
because nobody has asked them for anything**, and reporting that as *nothing is
outstanding* is how a fee goes uncollected — a green chip is the one thing on a
screen that nobody re-checks.

**`Not billed`** is that case named, in red. To tell it apart from a family who
has genuinely paid in full, the directory's grouped query now counts **every
voucher that is not cancelled**, not only the open ones: a paid voucher and no
voucher at all are both zero open vouchers, and only the wider count separates
them. It is a filter as well as a chip, so *show me who we have not billed* is
now a question the directory can answer.

**A fee taken in cash still reads `Cleared`.** Where a clerk pressed *Confirm the
fee was paid* and no voucher ever existed, somebody has said in writing that it
was paid, and their say-so is the record. Counting vouchers alone would have put
a settled family on a chasing list.

## 3. The voucher register now says who is missing from it

**The report:** *"Neither do I see his voucher in the vouchers section."*

That one is structural. The register is a list of vouchers, so a child who has
never been billed can never be a row in it, however the tabs are filtered. There
was nothing to see, and nothing said so.

It now carries the count above its tabs — *"1 enrolled student has no voucher at
all"* — narrowed by the reader's own campus and grade scope, so the number
counts children they can actually open, and linking straight to the directory
filtered to *Not billed*.

## 4. A corrected CNIC stopped fetching the family

**The report:** *"when I went on to enrolling this student, I entered a wrong
cnic, but when I re-entered the correct cnic, it did not fetch the father record
for existing siblings."*

The CNIC field fired the family lookup on the **invalid → valid** edge. The field
holds thirteen digits and two hyphens and accepts no more, so the only three ways
to change a number that is already complete are deleting from it, typing over a
selection, and pasting over one — and **the last two arrive as a single change
event whose previous value was also a valid CNIC**. The edge test read that as
"nothing has changed" and suppressed the lookup, while the form had already
cleared the match, correctly, because the number no longer named the person the
card was filled from.

So a clerk who selected a wrong digit and typed the right one over it was left
with no sibling banner, no prefill, and no way to get either back short of
reloading the page. The screen showed a family that is not a family — which is
the failure the CNIC rule exists to prevent, arriving from the opposite
direction.

The field now remembers the last number it asked about. A keystroke that changes
nothing still does not re-fire; every number that is genuinely new does. The
guardian panel on a student's profile shares the same field and had the same
defect.

**And the banner now offers *Use the record we hold*.** The sequence that goes
wrong most often is the one where the lookup helps least: a mistyped CNIC matches
nobody, the clerk enters the whole guardian by hand, and then corrects the
number — and by then every field is full, so the lookup's "only fill what is
empty" rule leaves a hand-typed record sitting beside a school saying it already
knows this person. The button reconciles the two. It appears only when they
actually differ, and nothing is overwritten until it is pressed.

---

## The migration

`0044` has one effect: `role_permissions_permission_check` is dropped and
re-added with a 45th key. It creates no table, adds no column and **rewrites no
row** — so every row count is identical either side by construction, and a census
can only ever confirm that nothing was damaged.

That makes the usual evidence useless, and reading `pg_constraint` is no better:
a constraint dropped and never re-added leaves every count identical *and* every
insert succeeding, which reads on any dashboard as success. So
`scripts/verify-0044.mjs` proves it **by attempt**, three ways, every attempt
inside a transaction that is always rolled back and with `role_permissions`
counted a third time afterwards:

- `fees.admission` **accepted** after the migration, and refused with exactly
  `23514` before it — which is itself the proof that the CHECK is live and that
  the migration was genuinely needed;
- `fees.invent` refused with `23514` either way, so the guard is still a guard;
- **all 45 keys tried one at a time**, because a re-add that quietly lost one
  would stay invisible until some school happened to override that single
  permission, months later, on a screen that had never failed before.

**It was applied before the code was deployed, and that order was not
arbitrary.** `role_permissions` stores only *departures* from the default, so
`fees.admission` works immediately for the roles that hold it by default with no
row in the table at all. The CHECK is reached the moment a school **overrides**
it — and the permissions screen saves every change in one transaction, so a
single toggle would have failed the whole save with a `23514` that no screen can
translate. That is exactly how `chat.oversight` shipped broken in Sprint 26.

---

## Evidence

All twelve green-build gates, plus `npm run check-sprint28`, which executes every
new and widened statement against the real schema — `listStudents` for all five
filter values, with a search that reaches the guardian phone, with a principal
scope on both axes and with an empty one; `countUnbilledStudents` four ways; and
the three reads behind the CNIC lookup. It reads whether `0044` is applied out of
the catalogue rather than being told, so one command works on both sides, and it
flipped itself from `0044 is NOT applied` to **`0044 is APPLIED`, 48 ok, 0 failed
or not exercised**.

A statement that has been read and not run is evidence about spelling and
nothing else — `listStudents` is the query that has been taken down twice by an
ambiguous column reference, and this sprint added four more aggregates to it, so
every alias is a name no joined relation carries and the emitted SQL was read
before it was trusted.

And because a tenant that matches no row proves the SQL plans and proves nothing
about what the chip says, the ranking was driven against **Askari's real rows**:

| | |
| --- | --- |
| Student 50 | `not_billed` — was `cleared` |
| Students 1–3 | `cleared`, unchanged — the regression that would have mattered most |
| filter `not_billed` | returns exactly Student 50 |
| unbilled count | 1 for Principal 1's grades, 0 for Principal 2's |

---

## Not in this sprint

**Admission vouchers cannot be raised in bulk.** The generation screen bills a
*period* for a *grade*; an admission fee is one charge for one child and is
raised from that child's profile. A school importing four hundred pupils still
has four hundred profiles to open. The directory's `Not billed` filter is what
makes the list of them visible; billing them in one run is not built.

**The unbilled count is not narrowed to the active academic year**, while the
directory it links to defaults to it. A child enrolled into a year that is not
the active one can therefore be counted and not listed until the reader changes
one dropdown. The alternative — adding the year — would *hide* a child enrolled
into next year and never billed, which is the exact case the count exists to
surface, and would report zero at a school with no year marked active.

**There is still no receipt.** A genuinely paid admission is settled and has
nothing to hand the parent but the voucher, which is a demand for money already
taken. Named here rather than papered over with the wrong document, as Sprint 20
named it.
