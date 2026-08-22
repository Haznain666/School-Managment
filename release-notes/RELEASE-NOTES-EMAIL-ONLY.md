# Release notes — Email only: WhatsApp leaves, and three faults it was sitting on

**Status:** merged to `main`. **Migrations `0027` and `0028` are applied** to the
live database — nothing to run, nothing to configure.

Four things were reported. One was a decision; three were bugs, and all three
turned out to be the same shape — something that had been true once, was
documented as still being true, and was not.

---

## Every message this platform sends now goes by email

WhatsApp is gone. Not switched off per school, not left behind a flag somebody
could turn back on — **removed**, from the invitation, the fee reminder, the
payment confirmation, the admission acknowledgement, the admission decision and
the announcement.

What that means in practice:

| You do this | It goes | Where it used to also try |
| --- | --- | --- |
| Invite a member of staff | email | WhatsApp, when the add-on was on |
| Chase an overdue challan | email | WhatsApp |
| Record a payment at the counter | email | WhatsApp |
| Accept, reject or waitlist an application | email | WhatsApp |
| Send an announcement | notice board, and email if you ask | WhatsApp |

**The Channels section is gone from the Super Admin school page**, and from the
bulk "Modules across schools" screen. There is nothing there to configure any
more, because there is nothing left to choose: email is not a switch, it is how
the product talks to people.

**GoHighLevel stays.** A school that has connected its own sub-account still
gets contact sync and still fires its own admission workflow. What it no longer
does is carry a message from us — everything now leaves through the email
outbox, which is the queue that already had retries, a delivery health screen
and a failure log behind it.

> **What a school loses:** a guardian with no email address on file now receives
> nothing. That was already true for every school without the add-on, which was
> all of them — but the number is now the one that matters. The **Defaulters**
> report still counts and reports those guardians every time you send, so
> "reached 260 of 300" appears at send time rather than being discovered when
> the fees do not arrive.

---

## Fixed: the invite form refused every number it produced

**Reported as:** "invalid mobile number" on a perfectly ordinary Karachi
landline.

**What was happening:** the Phone field masks as you type and produces
`(021) 444444`. The server checked it against a pattern that allowed digits,
spaces and dashes — and **no brackets**. So the server rejected the form's own
output. There was no number anybody could have typed that would have passed.

Worse, the field had also been told the number was an *identity*, which refuses
a landline outright with "this has to be a mobile — invitations and sign-in
codes are sent to it". Neither half of that was still true. The account is
created against the **email address**, and nothing is sent to the phone number
at all.

**Now:**

- **A landline is accepted.** So is a mobile. The dropdown means what it says.
- The server checks the number with exactly the same rules the form uses, so
  what the screen accepts is what the server accepts.
- The hint under the field says what the number is actually for — the school's
  own records.

The number is still required, because a staff record has to carry one and two
staff cannot share one. It is just no longer pretending to be a login.

---

## Fixed: the dashboard would not load

**Reported as:** "Could not load the dashboard", with a reference number, on the
screen an administrator lands on after signing in.

**What was happening:** the accounting release added a **Profit this month**
tile. Its tables had never been created on the live database. The dashboard
loads its six figures together, so the one that could not be read took the
other five down with it — the student count, the staff count, the collection
chart, the attendance chart and the class-strength chart all disappeared behind
one tile's missing table.

**Now:** the tables exist, so the tile works. And the dashboard has been changed
so this cannot happen again in this shape: **each figure fails on its own.** If
one cannot be read, that tile says so and the rest of the page still loads.

A tile that cannot read its figure says "unavailable" — it never shows a zero.
A zero and a missing figure look identical on screen, and that is how a school
comes to believe it collected nothing today.

---

## Fixed: "Unexpected response." on the Super Admin sign-in

**Reported as:** a bare "Unexpected response." under the password box, with no
way past it.

That message appeared whenever the server answered with something that was not a
proper reply — which, in practice, means the request never reached the
application at all: the process restarting, a slow first request timing out at
the host, or a genuine crash. All three looked the same, and the only difference
that matters — *wait a moment and try again* versus *something is broken* — was
the one it hid.

**Now** the message says which it is:

- "The server is not responding (502). It may be restarting — try again in a
  moment."
- "The server could not be reached. Check your connection and try again."
- "The server returned an unexpected response (500). Nothing was changed."

And the sign-in route itself — the only route on that surface without one — now
has proper error handling, so a genuine failure comes back as a message you can
quote rather than as a blank refusal.

> **On the report itself:** the live sign-in endpoint was tested during this
> work with a deliberately wrong address and answered correctly, with "Incorrect
> email or password." So whatever produced that screenshot had already passed.
> The fix is not that the login was broken — it is that the screen should have
> told you it was a temporary problem instead of leaving you looking at three
> words.

---

## Also fixed, after a QA pass

- **The application success page** told a parent their school would contact
  them *"at (0321) 123-4567 by email"*. The number is gone from that sentence —
  and out of the address bar, where it should not have been.
- **The phone field on the public form** said "we will contact you on this
  number". It now says what the number is actually for: finding your
  application if you come back. We reply by email.
- **A dashboard figure that cannot be read now says so** instead of quietly
  disappearing. A missing tile looks identical to a module you have not bought.
- **Very short phone numbers are refused again.** The fix above had
  accidentally allowed a four-digit entry through; a landline now needs its
  area code plus at least four digits, as it always did.
- **The public application form and the accept/reject decision no longer wait
  on the mail server** before replying. Both hand the message to the outbox,
  which retries and records failures — so a slow mail host no longer keeps a
  parent waiting on the submit button.

## For the record

- Migration `0028` removes the WhatsApp columns and flags. **Announcement
  delivery history is kept** — rows that went over WhatsApp are re-labelled to
  the notice board rather than deleted, because they are your record of what you
  told which parent and when.
- Migration `0027` — the accounting schema from the previous release — is also
  now applied. That is what fixes the dashboard at the root.
- All nine build gates pass, plus all five checks that run against the real
  database. One of those, `check-reports`, had been failing for the same reason
  the dashboard was: it now passes.

## Not done in this release

**Nothing here has been clicked through in a browser.** Signing in needs a
password, and this work was verified by running the queries against the real
database, by the build, and by the automated checks — not by eye. Twenty minutes
with a real login on the invite form, the dashboard and the Super Admin school
page is the next thing worth doing.
