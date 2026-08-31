# Sprint 21 — My Results works again, and one email is one person

**Two things were wrong, and they had the same screenshot.** A parent at LGS
Defence reported that he could see only one of his four enrolled children, and
that My Results showed an error. The error and the missing children turned out
to be the same fault twice over.

**Migration `0038` is written and not yet applied.** Unlike Sprint 20, the code
in this release goes out **first** — everything below works on today's database.
One symptom, and only one, waits for the migration: the parent above still
lands in the wrong portal until it is applied.

---

## The results page that had never worked

**My Results — on both the student portal and the parent portal — has been
returning an error since the exam module shipped.** Not intermittently, and not
at one school: the query behind it was refused by the database outright, every
time, everywhere. It had never once shown a report card to anybody.

The same query sits behind the results panel on each child's card on the parent
dashboard. When it failed there, the card still drew — it simply came up blank
where the attendance chart and the latest result should be, and nothing said
why. That is the "their information is missing" in the report: not missing data,
a panel that could never fill.

**Both are fixed and both were verified against real records** — one student who
has a published term, one who has none. The first now shows their term; the
second correctly shows nothing, rather than an error.

Nothing about what a family may see has changed. Unpublished terms are still
invisible to them, exactly as before.

## One email address, one person

**The platform now refuses to let two active people at one school share an email
address.** It had never forbidden it, and one school found out why that matters.

A father with five children enrolled had signed in with his own address for
months and been placed in the **student portal, as one of his own daughters**.
Four of his five children were unreachable by any login he had. Nothing on any
screen said anything was wrong — he simply had one child instead of five, and a
results page that errored.

The cause was a chain of small, individually reasonable things:

* children's directory records used to borrow a parent's mobile number, because
  children rarely have one of their own;
* opening a parent portal account matches on that number;
* so his account was opened *onto his daughter's record*, and his sign-in bound
  itself there permanently.

The first link in that chain was fixed some time ago — a child's record now
carries a marker built from their admission number, never a parent's phone. What
was never done was repairing the records already made that way, and nothing
prevented the same collision happening to them again.

**This release closes all of it:**

* enrolling a child can no longer link a guardian to another child's record;
* opening a parent portal account checks first, and if the number or the address
  already belongs to somebody else at that school it says so plainly, naming the
  person and what to correct. It never fails with a technical error and it never
  writes to the wrong record;
* signing in resolves to exactly one membership. Where an address is somehow
  claimed by two, the platform now refuses to guess — it signs the session out
  rather than seating somebody in the wrong portal.

**Migration `0038` finishes the job**: it re-points every guardian record that
was linked to a child's, gives those children's records their proper marker
back, and adds the constraint that makes the whole situation impossible from
then on. Until it is applied, the affected father still lands in the student
portal.

**After it is applied, he must sign in with the emailed code once**, not a saved
password. The migration releases his account from the wrong record, and the
emailed code is what attaches it to the right one.

## Two email addresses are only a problem when they are the same

Worth saying plainly, because it changes what the platform will accept:

* a member of staff with no email address on file is fine, as it always was;
* somebody who has left, and is deactivated, does not block their own address
  being used again when they return;
* two **active** people at the same school may no longer both be recorded under
  one address. If your office genuinely shares an inbox, each person needs their
  own address — one address is now one login, and one login is one person.

Capital letters no longer make a difference either. `Parent@Example.com` and
`parent@example.com` are the same person to the platform now, in every place
that matters, which is how email has always worked and how the platform now
behaves.

---

## What was found and deliberately not fixed

One guardian record at LGS holds a national ID number of 32 digits — a value
that cannot be a real CNIC. Because that number is what tells the platform which
children are siblings, it will keep that family split in two on the sibling list
and on a family fee voucher.

**It has not been corrected, on purpose.** Correcting it means inventing a
national ID number for a real person, which is the school's to do and nobody
else's. It is recorded in the deployment notes so it is not lost.

## Not yet driven at a school

Everything above passes twelve automated checks, including a new one that
executes every query in this release against the real database with real
records — which is precisely the check that was missing when the results page
shipped broken. **No screen in this release has yet been opened by a person**,
and the parent-portal outcome cannot be confirmed until `0038` is applied.

The one acceptance test that settles it: sign in at LGS with the father's own
address, using the emailed code, and land in the **parent** portal with five
children listed, each showing attendance and results.
