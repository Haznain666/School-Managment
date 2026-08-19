# Test cases — Dashboard, deletion UI, branch delete, and email delivery

Traces to [`RELEASE-NOTES-DASHBOARD-DELETION-AND-EMAIL.md`](../release-notes/RELEASE-NOTES-DASHBOARD-DELETION-AND-EMAIL.md).
No migration.

**Branch deletion is the opposite of school deletion, and that is the whole
point.** A school's 61 foreign keys cascade cleanly. A branch's thirteen mostly
`ON DELETE SET NULL`:

> Postgres would happily delete a busy campus and quietly detach four hundred
> students, their teachers and their payroll history from any campus at all.
> Nothing would error.

So UC-DDE-06 is the case that matters here, and it is a case that must **fail to
delete**.

---

## The dashboard charts

#### UC-DDE-01 · Platform growth draws empty months as gaps — P1
**Role** Super Admin · **Traces to** "Months with no signups are drawn as gaps rather than omitted: a growth chart that skips its empty months draws a flat line through a quiet quarter and calls it steady"
1. Open the Super Admin dashboard with at least one month having no signups.
- **Expect** twelve months, the quiet ones present and visibly empty.
- **Fail** if empty months are omitted — the chart then reports steady growth through a quarter with none.

#### UC-DDE-02 · "Where the students are" counts enrolled only — P1
**Role** Super Admin · **Traces to** "`enrolled` only — counting graduated and withdrawn students would make a school that has run for years look larger than one currently teaching more children"
1. With a school holding graduated and withdrawn students, read the chart.
- **Expect** only currently enrolled counted.
2. With no school having enrolled anyone, read it again.
- **Expect** a correct empty state — the release recorded exactly that.

#### UC-DDE-03 · Module adoption is gone — P3
**Role** Super Admin · **Traces to** "**Module adoption is gone.**… an answer to a product-research question that nobody looking at this screen was asking. It was also the tallest thing on the page"
1. Open the dashboard.
- **Expect** two compact charts, no module-adoption chart.
- **Fail** if it returns; do not re-test the old horizontal-label fix here.

---

## The delete-school dialog

#### UC-DDE-04 · The table does not show through the dialog — P1
**Role** Super Admin · **Traces to** "The Table's own sticky header sits at `z-sticky`, which is **1100**. The dialog was written with a raw `z-50`"
1. Open the delete dialog on a long, scrolled Schools table.
2. Screenshot it, and read the computed z-index.
- **Expect** nothing from the table intersects the dialog; backdrop at `z-backdrop` (1200), card at `z-modal` (1300).
- **Fail** on any bleed-through. Use the project's **named** z-index scale — a raw `z-50` anywhere in a modal is the defect returning.

#### UC-DDE-05 · The dialog has spacing, and its buttons line up — P2
**Role** Super Admin · **Traces to** "`space-y-4` was on the `Card`, whose children are its own header/body/footer wrappers… Every element sat flush against the next"
1. Open the dialog; measure Cancel and Delete.
- **Expect** visible spacing between elements; the two buttons share an exact top and height (verified at 760px / 40px each).
2. Shrink the viewport vertically.
- **Expect** `max-h-[90vh]` with scrolling — the buttons stay reachable.

---

## Branch deletion

#### UC-DDE-06 · A branch with anything attached refuses to delete — P1
**Role** Super Admin · **Traces to** "So this refuses. A branch is erasable only while nothing is attached to it"
1. On a **throwaway campus**, attach one portal member. Attempt deletion.
- **Expect** `409`, refused.
2. Repeat for students, staff, invitations, payroll runs and payslips.
- **Expect** refused each time.
- **Fail** on any success. A silent detach leaves four hundred students school-wide, appearing in every branch filter, with no record of where they were — and **nothing errors**.

#### UC-DDE-07 · The refusal names the counts — P2
**Role** Super Admin · **Traces to** "'this branch is in use' sends an operator hunting and '1 portal member' does not"
1. Read the refusal.
- **Expect** the specific counts, not a generic message.

#### UC-DDE-08 · A Postgres-level refusal is explained, not a 500 — P2
**Role** Super Admin · **Traces to** "A branch whose grade ladder is in use by sections or enrolments can still be refused by Postgres itself; that refusal is caught and explained"
1. Delete a branch whose grade ladder is in use.
- **Expect** an explanation.
- **Fail** on a 500.

#### UC-DDE-09 · The full branch path works — P1
**Role** Super Admin · **Traces to** the verification table
1. On a throwaway campus: create with `inviteAsBranchAdmin`; delete with a member attached (`409`); remove the member (`200`); delete with a wrong `confirmName` (`400`); delete with the correct name (`200`).
- **Expect** exactly that sequence; other branches intact.

---

## Email delivery

#### UC-DDE-10 · Creating an administrator queues the email — P1
**Role** School administrator · **Traces to** "`POST .../users` wrote the row and stopped… That is the whole of 'I created an Admin and the email is not being received' — nothing was ever queued, and no screen said so"
1. Create an administrator. Check `email_outbox` and the screen.
- **Expect** queued, and the screen reports whether it was.

#### UC-DDE-11 · A queue failure does not fail the request — P1
**Role** School administrator · **Traces to** "A failure does not fail the request: the member exists and is useful"
1. Break SMTP; create an administrator.
- **Expect** the member is created; the failure is reported but not fatal.

#### UC-DDE-12 · A branch email can be invited as branch administrator — P2
**Role** Super Admin · **Traces to** "It was a *contact* field — printed on a challan, never mailed — so typing an address into it and waiting was a silent no-op"
1. Create a branch with an email; use the offer to make it the branch administrator.
- **Expect** a `branch_admin` is created and a setup link queued.
2. Try it **without** a mobile.
- **Expect** the form says a mobile is needed — `school_users.phone` is NOT NULL and unique per school — "rather than failing later".

#### UC-DDE-13 · The invitation is offered, never assumed — P1
**Role** Super Admin · **Traces to** "It asks rather than assuming, because this creates a person with access to the school, and some branches have only a front-desk address nobody should sign in with"
1. Create a branch with an email and **decline** the offer.
- **Expect** no account is created.
- **Fail** if an address typed as a contact detail silently gains portal access.

#### UC-DDE-14 · Abandoned mail can be retried — P2 · **NEEDS PANEL**
**Role** Super Admin · **Traces to** "the outbox gives up after five attempts, which is right for a transient fault and wrong for a credential one"
1. With abandoned messages present, read the Email Delivery card.
- **Expect** *Retry N abandoned messages* with the right count.
2. **Only after the panel credentials are fixed**, press it.
- **Expect** it requeues and drains once, and the response says how many actually went out — or hands back the SMTP server's new complaint.

> **Do not press this button casually.** The release deliberately did not: "The
> local environment has *working* SMTP credentials, so pressing it would have
> sent seven real, months-old invitations to real people's inboxes." That is the
> operator's call, not a QA side effect.

#### UC-DDE-15 · Setup-email logic has one implementation — P3
**Role** Developer · **Traces to** "The shared setup-email logic moved to `lib/access-email.ts`; it now has three callers and cannot drift between them"
1. Confirm all three callers use it.

#### UC-DDE-16 · `admin.createUser` sends nothing, and that is expected — P2
**Role** Operator · **Traces to** "'Supabase shows 200 but no email arrives' is two different systems being conflated: creating the account is `admin.createUser`, which returns 200 and **sends nothing at all** — it never did"
1. Create an account and watch Supabase.
- **Expect** 200 and no Supabase email. The platform's own mail is the one that matters.
- **Do not raise** the absent Supabase email as a defect; it is a documented false alarm that already cost one investigation.

---

## Estate note

Six schools — `oneten`, `proton`, `ABC Demo`, `Usman Public`, `check`, `credo` —
were deleted between sessions on 2026-08-19, leaving three. **Confirm what is
actually in the database before assuming any case's preconditions hold**,
particularly anything marked **NEEDS TENANCY** or **NEEDS SEED**.
