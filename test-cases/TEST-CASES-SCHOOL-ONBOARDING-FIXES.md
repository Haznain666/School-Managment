# Test cases — School onboarding, fixed

Traces to [`RELEASE-NOTES-SCHOOL-ONBOARDING-FIXES.md`](../release-notes/RELEASE-NOTES-SCHOOL-ONBOARDING-FIXES.md).
**No migration.** **Not a sprint** — three defects on the path a new school
actually walks.

**Every rule here is enforced twice**, in the browser and again on the server,
from the same code. So the validation cases have two halves: click it, then post
the same bad value directly. A form is not a gate — a request posted directly
never runs the browser's code.

**Two of these need a school with no branches**, which an existing school cannot
be made into safely (deactivating a live campus to test is a write to real data,
and was refused for that reason during development). Test them on a school
created for the purpose, and delete it afterwards.

> **What was already verified during development, and what was not.** The new
> branch route was driven through six refusal paths plus a duplicate-code
> conflict that runs the real INSERT without leaving a row; the permission gate
> was checked from a `branch_admin` session; the redirect was confirmed to fire;
> and all three changed pages were rendered as a school administrator against
> the live database. **Nothing about the school-creation email was exercised
> end to end** — that needs a real school to be created, which provisions a
> subdomain. UC-SOF-01 through UC-SOF-05 are therefore genuinely untested.

---

## Creating a school emails its administrator

#### UC-SOF-01 · The administrator is emailed a password link — P1 · **UNTESTED**
**Role** Super Admin · **Traces to** "creating a school created its first administrator and then sent them nothing at all"
1. Create a school, giving an administrator name, mobile and an address you can read.
2. Open that mailbox.
- **Expect** one message, subject *Set up your <school> account*, carrying a `/set-password/<token>` link — **not** a six-digit code and **not** an `/invite/` link.
- **Expect** the link opens a choose-a-password screen and signing in with that password afterwards works.
- **Fail** if nothing arrives. This is the whole defect.

#### UC-SOF-02 · The token exists in the database, not just in the mail — P1
**Role** Operator, database · **Traces to** "Written before the message is queued, so a link cannot be mailed that the database does not know about"
1. After UC-SOF-01, read `password_setup_tokens` for the new school.
- **Expect** exactly one row, `school_user_id` pointing at the new administrator, `created_by` recording the operator who created the school.
- **Fail** if the row is absent while the email was sent — that is a link nobody can redeem.

#### UC-SOF-03 · The link is single-use and expires — P2
**Traces to** "valid for 48 hours"
1. Redeem the link from UC-SOF-01, then open it again.
- **Expect** refused the second time.

#### UC-SOF-04 · A failed send lands the operator on Users — P1
**Role** Super Admin · **Traces to** "It now sends you to the school's **Users** tab whenever *either* the administrator was not created *or* the email did not make it into the queue"
1. Break the send deliberately — unset `SMTP_HOST` — and create a school with a valid administrator.
- **Expect** the school is still created, the administrator is still created, and you land on the school's **Users** tab rather than the overview.
- **Expect** *Send sign-in email* is available there, and pressing it after restoring SMTP delivers the same setup email.
- **Fail** if you land on the overview. A silent failure here is the original defect wearing different clothes.

#### UC-SOF-05 · A landline as the administrator number still creates the school — P2
**Role** Super Admin · **Traces to** "This deliberately does not fail the request. The school row is already committed and is useful on its own"
1. Create a school whose administrator number is not a valid mobile.
- **Expect** the school exists, no administrator was created, the reason is shown, and you land on **Users**.
- **Fail** if the school creation is rolled back.

---

## Invite Staff, with no branches

#### UC-SOF-06 · Invite Staff redirects to branch creation — P1
**Role** School administrator, at a school with **no branches** · **Traces to** "The screen was asking for something it had not let you create"
1. Open **Users & Staff**, press **Invite Staff**.
- **Expect** you land on *Add your first branch*, not on the invite form with an empty dropdown.
- **Expect** the screen says you were inviting somebody and will be brought back.

#### UC-SOF-07 · Creating the branch returns you to the invite form — P1
**Role** School administrator · **Traces to** "brings you straight back to the invite form afterwards"
1. Continue from UC-SOF-06 and save the branch.
- **Expect** you land on **Invite staff**, with the new branch selectable in the Branch dropdown.
- **Fail** if you land on the branch list — the errand is not finished.

#### UC-SOF-08 · Nobody is invited during branch creation — P1
**Role** School administrator · **Traces to** "Offering it twice is how one person quietly becomes two. The toggle is simply not there"
1. On the school-side branch form, fill in the campus **email** field and save.
- **Expect** no *Invite this email as the branch administrator* toggle is present at all.
- **Expect** no new row appears in **Users & Staff**, and no email is sent to that address.
- **Fail** if a `branch_admin` is created. This is the user's explicit requirement.

#### UC-SOF-09 · The Super Admin form still offers the invite — P2
**Role** Super Admin · **Traces to** "an operator setting a school up over the phone has no other chance to give the campus somebody"
1. Open the Super Admin branch form for any school; enter an email and a mobile.
- **Expect** the invite toggle **is** offered, and still works.
- **Fail** if this was removed. Only the school-side form drops it.

#### UC-SOF-10 · The first campus becomes the main branch — P1
**Role** School administrator · **Traces to** "A school with exactly one branch and no main branch is a state nobody chooses on purpose"
1. Create the first branch with **Main branch** left off.
- **Expect** it is stored as the main branch anyway.
2. Create a second branch, also with Main branch off.
- **Expect** the second is **not** main, and the first still is.

#### UC-SOF-11 · Setting main demotes the previous holder — P2
**Role** School administrator
1. With two branches, create or mark a third as main.
- **Expect** exactly one main branch across the school afterwards.

#### UC-SOF-12 · Someone who cannot create branches is not bounced — P1
**Role** A role holding `users.write` but not `settings.write` (HR manager, by default) at a school with **no branches** · **Traces to** "Somebody who cannot create branches is not sent to a screen that would refuse them"
1. Open **Invite Staff**.
- **Expect** a plain explanation that a campus must exist and that a school administrator can add one — not a redirect, and not a permission wall.

#### UC-SOF-13 · Deactivating stays with the operator — P2
**Role** School administrator · **Traces to** "would have hidden a campus with no way left to find it"
1. Open the school-side branch form.
- **Expect** there is no **Active** toggle.
2. Open the Super Admin branch form.
- **Expect** there is.

---

## The branch route itself

#### UC-SOF-14 · Refusals, browser and server — P1 · both halves
**Role** School administrator · **Traces to** "A form is not a gate"
Post each of these directly to `POST /api/school/branches` **and** try the same in the form:

| Body | Expect |
| --- | --- |
| code that already exists at this school | 409, *A branch with that code already exists at this school.* |
| a city not on the list | 400, *Select a city from the list.* |
| `curriculumLevel: MIXED` with no board name | 400, naming the board |
| `curriculumLevel` that is not one of the four | 400 |
| no name | 400, *Branch name and code are required.* |
| a malformed mobile | 400, naming the format |

- **Fail** if any of these succeeds when posted directly.

#### UC-SOF-15 · The permission gate holds — P1
**Traces to** "Creating a campus needs the same permission as editing the school profile"
1. As a `branch_admin`, POST to `/api/school/branches`.
- **Expect** 403.
2. As the same `branch_admin`, GET `/api/school/branches`.
- **Expect** 200 — reading the branch list is what every invite and user form depends on.

#### UC-SOF-16 · One school cannot create a branch at another — P1 · **NEEDS TENANCY**
**Traces to** "Always from the verified session, never from the body"
1. Signed in at School A, POST a branch with a `locationId` for School B in the body.
- **Expect** the branch lands at School A, or is refused. Never at School B.

#### UC-SOF-17 · The return address cannot leave the portal — P2
**Traces to** "without this an emailed link could bounce an administrator to any origin"
1. Open `/dashboard/branches/new?next=https://example.com` and save a branch.
- **Expect** you land inside the portal, never on the external address.
2. Repeat with `?next=/super-admin`.
- **Expect** the same — only `/dashboard/...` is honoured.

#### UC-SOF-18 · The Branches page exists and lists campuses — P2
**Traces to** "The link has been in the sidebar for several releases and led to a missing page"
1. Click **Branches** in the sidebar.
- **Expect** a page, not a 404.
- **Expect** an empty state offering *Add branch* when there are none, and the campuses listed when there are.

---

## The copy that was not true

#### UC-SOF-19 · The invite page names the real channel — P2
**Role** School administrator · **Traces to** "the page was telling administrators their invitation had gone somewhere it had not"
1. Open **Invite Staff** at a school **without** the WhatsApp add-on.
- **Expect** *The invitation goes out by email.* No mention of WhatsApp.
2. Enable the WhatsApp channel for that school and reload.
- **Expect** the wording now names both.

#### UC-SOF-20 · The phone field gives the real reason — P3
**Traces to** "The number is required because it is how a member is identified within a school"
1. Submit the invite form with the phone blank.
- **Expect** the message says the number identifies the member, not that invitations go over WhatsApp.

---

## Tenant lookup resilience

#### UC-SOF-21 · A failed lookup does not accuse the tenant — P1
**Role** Operator · **Traces to** "a single slow or refused database call told a signed-in administrator that their school does not exist"
1. Load any school page so the school is resolved once.
2. Make the lookup fail — block the Supabase host, or point `SUPABASE_URL` at a dead address — then load another school page.
- **Expect** the page still renders. **Expect** the server log carries *school lookup for "<slug>" failed; serving the last known result*.
- **Fail** if *School portal unavailable* appears. That is the defect.

#### UC-SOF-22 · A cold start with a broken lookup still fails safe — P2
**Traces to** "only a *first* lookup, with nothing cached at all, can still fail"
1. Restart the app with the lookup already broken, then load a school page.
- **Expect** *School portal unavailable*. Serving a school nobody has ever resolved would be inventing one.

#### UC-SOF-23 · Deactivating a school still takes effect within a minute — P1
**Role** Super Admin · **Traces to** "that answer arrives as a *successful* reply and replaces what was remembered"
1. Load a school page. Deactivate the school from the Super Admin panel.
2. Wait 60 seconds and reload.
- **Expect** *School portal unavailable*.
- **Fail** if the school stays reachable. The fallback must not keep a deactivated tenant alive.

#### UC-SOF-24 · A slug that genuinely does not exist is still refused — P1
1. Visit a subdomain for a school that was never created.
- **Expect** *School portal unavailable*, immediately.

---

## Regression

#### UC-SOF-25 · Everything that already emailed still emails — P1
**Traces to** "Every other path that creates a member queues the access email"
1. Add an administrator from a school's **Users** tab in the panel.
2. Create a branch in the **Super Admin** panel with the invite toggle on.
- **Expect** both still send their setup email, unchanged.

#### UC-SOF-26 · The Super Admin branch form is unchanged in every other way — P2
**Traces to** the form being shared between both panels now
1. Create and then edit a branch from the Super Admin panel.
- **Expect** city proposes the code, Mixed demands a board, the class list follows the curriculum, Main and Active both work, and editing saves — exactly as before.
- **Fail** if sharing the form with the school portal changed any of it.

#### UC-SOF-27 · Invite Staff is unchanged at a school that has branches — P1
**Role** School administrator, at a school **with** branches
1. Open **Invite Staff**.
- **Expect** no redirect. The form as before, branches selectable, invitations sending.
