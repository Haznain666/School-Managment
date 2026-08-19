# Release notes — School onboarding, fixed

**Status:** merged to `main`. **No migration.**

**This is not a sprint.** It is three defects reported on the path a new school
actually walks: create the school, get its administrator in, invite the first
member of staff. Sprint 13.5 (accounting) is still the next sprint, and Sprint
14 is still internal chat.

One of the three could not be reproduced. That is written up honestly below
rather than dressed as a fix, because knowing what was *not* proven is worth
more than a confident sentence that turns out to be wrong.

---

## Creating a school now emails its administrator

**The defect:** creating a school created its first administrator and then sent
them nothing at all.

Nothing about that was visible. The account existed, the panel said so, the
operator moved on, and the person named as administrator waited for an email
that had never been queued. What they eventually received — if anybody thought
to go and send it — was whatever somebody sent by hand afterwards.

**How it was proven, rather than guessed.** The live database was asked directly.
`password_setup_tokens` held exactly one row for the school in question: the
branch administrator, created from the branch form. The *school* administrator,
created an hour earlier by school creation itself, had none. The outbox told the
same story from the other end — the only message that address ever received was
an invitation link queued nine minutes later, by hand.

**The cause is a one-line omission with three witnesses.** Every other path that
creates a member queues the access email. Adding an administrator from the Users
tab does it. The branch form does it. The module that sends it opens by
explaining that it exists as a shared module *precisely* so those callers cannot
drift apart. School creation was the one route that never called it — and it is
the route that provisions the very first person into a school, which is the one
person who has no other way in.

**What happens now.** Creating a school queues that administrator a link to
choose their password, valid for 48 hours, exactly as every other path does.

**And the panel says whether it went.** The form used to send you to the school
overview unless the administrator could not be created at all. It now sends you
to the school's **Users** tab whenever *either* the administrator was not
created *or* the email did not make it into the queue — which is where the
"Send sign-in email" button lives, so the screen you land on is the one that can
finish the job. A school nobody can sign in to is not provisioned, only
recorded.

---

## Invite Staff no longer asks for a branch you cannot create

**The defect:** every role worth inviting — teacher, accountant, HR manager,
branch administrator — has to be assigned to a branch. A school that had never
had a branch entered saw the invite form render, the Branch dropdown stand
empty, and the only feedback be *"this role must be assigned to a branch"*
pointing at a list with nothing in it. The screen was asking for something it
had not let you create.

It had not let you create it because branches could only be made from the Super
Admin panel, which a school administrator has no login for. The real next step
was to email the platform operator and wait.

**A school can now create its own campuses.**

- **Invite Staff sends you to create one first**, and brings you straight back
  to the invite form afterwards. The branch screen says so, so the detour does
  not read as having lost your place.
- **Nobody is invited during branch creation.** This is the important half. The
  Super Admin version of the branch form offers to turn the branch email into
  that campus's administrator, because an operator setting a school up over the
  phone has no other chance to give the campus somebody. Inside the school
  portal that reasoning does not hold — you are already signed in, and the
  invite form is the *next screen*. Offering it twice is how one person quietly
  becomes two. The toggle is simply not there.
- **The first campus is automatically the main one.** A school with exactly one
  branch and no main branch is a state nobody chooses on purpose, and it quietly
  breaks anything that prints "the main campus" on a challan or a report.
- **Somebody who cannot create branches is not sent to a screen that would
  refuse them.** Creating a campus needs the same permission as editing the
  school profile — by default the school administrator only. Anyone else who can
  invite staff but not create branches gets a plain explanation and is told who
  can help.
- **Branches is now a real page.** The link has been in the sidebar for several
  releases and led to a missing page. It now lists the school's campuses and
  offers *Add branch*.

**Deactivating a branch stays with the platform operator**, deliberately. Inside
the portal an inactive branch is invisible — it disappears from every picker,
including the one on the screen that would switch it back on. A school
administrator who turned one off would have hidden a campus with no way left to
find it.

---

## Two sentences that were not true any more

**The invite page said invitations go out over WhatsApp, with email as a
fallback.** That reversed some time ago and the page never caught up: email is
what the account is created against and the channel that has to work, and
WhatsApp is a paid add-on most schools do not have. So the page was telling
administrators their invitation had gone somewhere it had not. It now asks
whether the school actually has WhatsApp and says what will really happen.

**The phone field said a number was required because invitations go over
WhatsApp.** The number is required because it is how a member is identified
within a school — every member has exactly one, and no two members share one —
whether or not anything is ever sent to it. It now says that.

---

## "School portal unavailable" — reported, and not reproduced

A school administrator clicked **Users** and got the page that says *This
address does not lead to an active school portal.*

**This was not reproduced, and this section will not pretend otherwise.** What
was established:

- The live site answers that address correctly — sampled repeatedly, signed out
  and with a deliberately invalid session, and it behaves correctly both ways.
- Run locally against the live database, the page renders for a school
  administrator, for a branch administrator, and for a platform operator using
  the *Login as Admin* hand-off.
- The school itself is fine: it exists, it is active, and its permissions are at
  their defaults, under which a school administrator holds every key.

**One real fault was found and fixed while ruling things out.** Deciding which
school a web address belongs to means asking the database, and that question has
two different failure answers: *no school by that name*, and *the question could
not be asked*. The code that asks was careful to distinguish them. The code that
*used* the answer was not, and treated both as "no such school".

So a single slow or refused database call — one dropped connection, one
rate-limited second — told a signed-in administrator that their school does not
exist, on whichever page they happened to click next. Reloading fixed it. That
is exactly the shape of a fault that is real, impossible to reproduce on demand,
and blames the wrong thing when it appears.

Now, a school that resolved successfully a minute ago is remembered and reused
when the question cannot be asked again. It has not stopped existing because one
request failed. A school that is genuinely deactivated still becomes unreachable
within a minute, because that answer arrives as a *successful* reply and
replaces what was remembered.

**If the page appears again, this was not the cause.** The next thing to check
is the hosting side: there is evidence that more than one copy of the
application is running behind the same address, which is a known open item, and
the remedy there is restarting the app in the hosting panel rather than changing
any code.
