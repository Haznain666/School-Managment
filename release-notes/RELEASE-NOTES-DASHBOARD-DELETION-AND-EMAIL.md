# Release notes — dashboard, deletion UI, branch delete, and email delivery

**Date:** 2026-08-19
**Branch:** `claude/school-branch-creation-fixes-974895`
**Migration:** none

Four reported issues. The fourth — email not arriving — turned out to be a
configuration fault rather than a code one, but it exposed three genuine gaps
around it that are fixed here.

---

## 1. A meaningful dashboard graph

**Module adoption is gone.** Eleven module names, eleven bars, and between them
an answer to a product-research question — *which features do schools switch
on* — that nobody looking at this screen was asking. It was also the tallest
thing on the page.

Two compact charts replace it, chosen against what a platform operator actually
needs to know:

**Platform growth** — schools added in each of the last twelve months. Twelve
three-letter labels is exactly what the default vertical chart geometry was
built for, so it needs no special mode and takes a third of the room. Months
with no signups are drawn as gaps rather than omitted: a growth chart that skips
its empty months draws a flat line through a quiet quarter and calls it steady.

**Where the students are** — enrolled students at the six largest schools. On an
estate carrying test tenants, this is the figure that separates a school in use
from an empty shell. `enrolled` only — counting graduated and withdrawn students
would make a school that has run for years look larger than one currently
teaching more children.

---

## 2. The delete-school dialog

Two real bugs, both mine from the previous batch.

**The table showed through the dialog.** This project has a named z-index scale
in `tailwind.config.ts` and the Table's own sticky header sits at `z-sticky`,
which is **1100**. The dialog was written with a raw `z-50`. The header and the
row beneath it painted straight over the middle of the dialog — exactly what was
reported. It is now `z-backdrop` (1200) with the card at `z-modal` (1300),
matching the drawer in `SuperAdminShell`.

**Nothing had any spacing.** `space-y-4` was on the `Card`, whose children are
its own header/body/footer wrappers — with no header or footer passed, the outer
element had exactly one child and a class that styles the gaps *between*
siblings had nothing to act on. Every element sat flush against the next. The
spacing now lives on a wrapper inside the Card.

Also: `max-h-[90vh]` with scrolling, so a short viewport cannot push the buttons
out of reach, and the button row is `items-center` — Cancel and Delete now share
an exact top and height (verified at 760px / 40px each).

---

## 3. Branch deletion

New, and deliberately **not** a copy of the school one.

Deleting a *school* is clean: all 61 foreign keys to `schools.location_id`
cascade. A branch is the opposite — of the thirteen keys pointing at
`branches.id`, most are **`ON DELETE SET NULL`**: `students`, `staff`,
`school_users`, `school_invitations`, `payroll_runs`, `payslips`.

Postgres would happily delete a busy campus and quietly detach four hundred
students, their teachers and their payroll history from any campus at all.
Nothing would error. The rows would become school-wide, appear in every branch
filter, and there would be no record of where they used to be.

So this refuses. A branch is erasable only while nothing is attached to it —
which is exactly the case the feature is for: a campus typed in by mistake, a
duplicate, a test row. The refusal names the counts, because "this branch is in
use" sends an operator hunting and "1 portal member" does not.

A branch whose grade ladder is in use by sections or enrolments can still be
refused by Postgres itself; that refusal is caught and explained rather than
surfacing as a 500.

---

## 4. Email delivery

### The cause is a wrong credential in the hosting panel, not code

`email_outbox` tells the story plainly: **11 messages sent, the last on
2026-08-13. Then 7 straight failures, every one of them
`Invalid login: 535 5.7.8 Error: authentication failed`,** the most recent
today.

The same `SMTP_USER` and `SMTP_PASS` held in `.env.local` were tested directly
against `smtp.titan.email` and **authenticate successfully on both port 465 and
port 587**. During QA a branch invitation queued on the local server was
delivered `status: 'sent', attempts: 1` — the identical code path that returns
535 in production.

**So: the code works, the mailbox password works, and the copy in the Hostinger
panel does not.** Nothing in this repository can fix that. Update `SMTP_USER`
and `SMTP_PASS` in the panel and restart.

That also explains the second half of the report. "Supabase shows 200 but no
email arrives" is two different systems being conflated: creating the account is
`admin.createUser`, which returns 200 and **sends nothing at all** — it never
did. The email that matters is the platform's own, and it was failing at SMTP.

### Three gaps that were real, and are fixed

**Creating an administrator now sends the email.** `POST .../users` wrote the
row and stopped; "Send sign-in email" was a separate button an operator had to
know to press. That is the whole of "I created an Admin and the email is not
being received" — nothing was ever queued, and no screen said so. The creation
path now queues it and reports whether it was queued. A failure does not fail
the request: the member exists and is useful.

**A branch email can now be invited.** It was a *contact* field — printed on a
challan, never mailed — so typing an address into it and waiting was a silent
no-op. The form now offers to make that address the campus's branch
administrator and send them a setup link. It asks rather than assuming, because
this creates a person with access to the school, and some branches have only a
front-desk address nobody should sign in with. It needs the mobile too:
`school_users.phone` is NOT NULL and unique per school, so an email alone cannot
produce a row — and the form says so rather than failing later.

**Abandoned mail can be retried.** The outbox gives up after five attempts,
which is right for a transient fault and wrong for a credential one: at the
moment the panel is fixed, the queue is full of mail that will never be tried
again, and some of those flows have no resend anywhere. The Email Delivery card
now offers *Retry N abandoned messages*, which requeues and drains once so the
response says how many actually went out — or hands back the SMTP server's new
complaint, which is the useful answer if the credentials are still wrong.

The shared setup-email logic moved to `lib/access-email.ts`; it now has three
callers and cannot drift between them.

---

## Verification

Driven in a browser against the live database, with an operator session already
open — no password was typed.

**Dashboard** — both charts render compactly; the students chart shows its empty
state correctly (no school has enrolled anyone); the retry button renders with
the right count.

**Delete dialog** — screenshotted with no table content intersecting it;
`z-index: 1200` confirmed; Cancel and Delete measured at identical top (760) and
height (40).

**Branch delete** — full path on a throwaway `QA Probe Campus`, never on an
existing campus:

| Step | Result |
|---|---|
| Create with `inviteAsBranchAdmin` | branch created, `branch_admin` created, email queued |
| Delete with a member attached | `409` — "still has 1 portal member attached" |
| Remove the member | `200` |
| Delete with wrong `confirmName` | `400 confirmation_required` |
| Delete with correct name | `200`, branch gone, other 6 branches intact |

**Email** — SMTP credentials verified against the real server on both ports; the
QA invitation was actually delivered locally, which is the proof that only the
panel copy is wrong.

**Automated** — `check-forms` (60 assertions), `check-theme`, `check-reports`,
`check-dashboard`, `check-portals`, `check-provisioning`, `tsc --noEmit`,
`eslint`, and a green `next build`.

### Two things deliberately not done

**The retry button was not pressed during QA.** The local environment has
*working* SMTP credentials, so pressing it would have sent seven real, months-old
invitations to real people's inboxes. That is the operator's call to make after
fixing the panel, not a QA side effect.

**Six schools were deleted between the previous session and this one** — `oneten`,
`proton`, `ABC Demo`, `Usman Public`, `check` and `credo`, leaving three. That
was not done by this session, which only ever created and removed its own probe
and confirmed nine remained. It is recorded here because the deletion is
irreversible and the estate is now materially smaller.
