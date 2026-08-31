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

## The second round, after QA

The repair was driven against the live database before this shipped, and it
turned up six further problems — none of them in the fix itself, all of them on
paths that the new "one address, one person" rule newly constrains and that
nobody had looked at.

**The most important was in this release's own new code, and it would have hurt
exactly the families it was written for.** Opening a parent account refused any
address that was already in use at the school. Two entirely ordinary situations
run into that:

* **a mother and a father who share one email address**, which is common. The
  second of them got no account at all;
* **one parent recorded against two children under two different phone
  numbers.** The second child was refused — and the refusal happened *before*
  the parent was linked to that child, so the child disappeared from their own
  parent's portal, silently.

That is the very complaint this release opened with, wearing a different hat.

An address already in use now **joins the existing account** rather than being
turned away. One inbox is one login, so a father with two numbers on file sees
every one of his children under a single sign-in, and a household sharing an
inbox reaches the same portal. A **student's** address is still refused, and
always will be — that is the whole point of the release.

The remaining five were the platform showing "Something went wrong" where it
should have shown a sentence:

* **switching a former member back on** could fail outright, from either the
  school's own screen or the platform panel, if their address had been given to
  somebody else while they were switched off. It now says who has it;
* **adding a member** reported an address already in use as *a phone number*
  already in use — about a number nobody held, so there was nothing on the form
  to correct;
* **accepting an invitation** could fail in front of the invited person, who is
  outside the school and has nobody to ask;
* **requesting a sign-in code** could quietly decline to send one — to an
  address recorded with capital letters, or to somebody sharing an address with
  a former member. Nothing on screen would ever have said so, because the reply
  is deliberately the same whether a code was sent or not.

That last one is the one to know about. This release leaves exactly one person
— the parent whose account it unlocked — for whom the emailed code is the only
way back in.

## Not yet driven at a school

Everything above passes sixteen automated checks, including a new one that
executes every query and every guard in this release against the real database
with real records — which is precisely the check that was missing when the
results page shipped broken.

The database repair **is applied and verified**: the child's record has its own
identity back, the father's account is free, and all five of his children are
attached to it. The school's own administrative screens were driven in a
browser and are correct.

**The parent portal itself has not been opened by a person, and could not be.**
Unlocking that account is what frees it, and the only way back into it is a
six-digit code sent to the parent's own mailbox — which is not something anyone
but the parent should be handling.

So the one acceptance test that settles it is yours: sign in at LGS with the
father's own address, choosing **the emailed code rather than the saved
password**, and land in the **parent** portal with five children listed, each
showing attendance and results. The old password will not work until that is
done once; that is the unlocking, not a fault.
