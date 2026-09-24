# Sprint 35 — Super Admin invoicing, the central sign-in, and more than one operator

**Specified:** 2026-09-25, from the product owner's twelve-point brief.
**Migration:** `0052` (next free on `main` at `5b92587` — re-check before numbering).
**Brand files:** `public/brand/schoolhub-logo.png` (word mark), `schoolhub-mark.png`
(the "eyes", favicon), `schoolhub-bot.png` (the robot, login page only).

---

## §0 Decisions taken with the product owner (2026-09-25)

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Which month does the invoice raised on the 1st pay for? | **In arrears.** The 1 Nov invoice bills October. |
| Q2 | Who is locked out when a school is blocked? | **Everyone at the school** — staff, students, parents see a suspended page. The **school admin** still reaches one page showing the unpaid invoice(s) and the bank details, so they can pay. |
| Q3 | Who uses the central sign-in on the apex domain? | **Super admins and every school user** (staff, parents, students). The school-subdomain sign-in pages keep working. |
| Q4 | How fine are the other super admins' permissions? | **Create / View / Edit / Delete per area.** Only the owner edits the grid. |

Decisions taken by the engineering side (not blocking, recorded so QA tests against them):

| # | Decision |
| --- | --- |
| E1 | Money is **integer minor units** (US cents / PKR paisa) everywhere, as `lib/money.ts` already requires of the fee module. The USD→PKR rate is `numeric(12,4)`, i.e. PKR per 1 USD. |
| E2 | **A billable user** is an **active `school_users` row whose role is not `parent`**, counted by role at the moment the invoice is generated. A person with rows in two schools counts at each. |
| E3 | **Proration is by day.** Billable days in the billed month = days from `max(first of month, live_since, trial_ends_on + 1 day)` to the last day of the month, inclusive. Each line = monthly × billable_days / days_in_month, rounded half-up to the minor unit. A trial whose last free day is 20 Oct bills **21–31 Oct = 11 days** (the brief says "10 days"; 31 − 20 = 11 inclusive — the brief's example is off by one and this is recorded, not silently picked). |
| E4 | Trial: `trial_days` N starts on the day the school is made Live. `trial_ends_on = live_since + N − 1` (the last free day). N = 0 means no trial. |
| E5 | Due date is **the 10th of the month the invoice is generated in**. The school is blocked after **due date + grace_days** (default 2), i.e. from 00:00 **Asia/Karachi** on the 13th with the default. Blocking only applies to **finalized** invoices — a school is never blocked over a draft it has never been sent. |
| E6 | An invoice is **cleared** for blocking/renewal purposes once cumulative receipts ≥ **80%** of its total. **That threshold is never shown on any screen, email or PDF**, including the super admin's own screens — the UI says "Received" and "Balance carried to next invoice", never "partial", "80%" or "minimum". |
| E7 | **Carry-forward** happens at generation: the next invoice gets a line "Previous balance (INV-…)" equal to the unpaid remainder of every earlier finalized invoice, and those invoices are marked `carried_forward` so the amount is never counted twice. A receipt can be recorded only against an invoice that is not `carried_forward`. If the currencies differ the balance is converted at the school's current rate and the line says so. |
| E8 | Sandbox schools: no invoices, no trial, no reminders, no blocking. `live_since` is set when a school is switched to Live (and cleared if switched back). **Every existing school is Sandbox after `0052`.** |
| E9 | The Phase 1 modules (`admissions`, `fee_management`, `academics`) are **always on** and show **"Included"** instead of a switch — in the per-school modules tab *and* the bulk modules page. The API refuses to switch them off. Migration `0052` sets them on for every school. |
| E10 | Up to **3 discounts** per invoice, each `percent` (of the subtotal before discounts, basis points) or `fixed` (minor units), each with a required description. Only on a draft. Discount total can never exceed the subtotal. |
| E11 | Invoice email: the default recipient is the school's remembered `invoice_email` if set, else the school admin's email. Sending to a different address **stores that address as the new default**. Every send is logged (to, when, by). A finalized invoice can be re-sent to anyone at any time. |
| E12 | The PDF is generated server-side with **`pdf-lib`** (pure JS, no Chromium on Hostinger). It carries the SchoolHub logo, invoice no., school, period, lines, discounts, total, due date, and the platform bank accounts. |

---

## §1 User counts per school (brief point 1)

Schools list (super admin): a new **Users** column with the billable-user count (E2).
Clicking it opens a popover/dialog with the count **per role** (excluding parent),
e.g. Principal 1, Vice Principal 1, Section Head 2, Teacher 8, Student 100 = 112.
One grouped query for the whole list — not one per school.

## §2 Billing settings per school (brief points 2, 6, 9)

New **Billing** tab on the school detail page (`/super-admin/schools/[id]`):

- **Environment:** Sandbox / Live (E8). Going Live asks for confirmation and shows the date.
- **Billing currency:** USD / PKR.
- **Invoice currency:** USD / PKR — defaults to the billing currency; a change needs a confirm.
- **USD → PKR rate** — required whenever billing ≠ invoice currency.
- **Trial period (days)** and the computed trial end date (E4).
- **Grace period (days)** — default 2.
- **Invoice email** (the remembered default, E11), editable.
- **Per-role rate** for every role except parent, in the billing currency, with the live user count and the line total beside it, and the monthly estimate at the bottom.
- **Per-module rate** for every non-Phase-1 module the school has **enabled**, in the billing currency. Phase 1 rows show **Included**.
- **Access:** Active / Blocked, with manual **Block** / **Unblock** (confirm, and the school admin is emailed either way).

Estimate example that must reproduce on screen: 1 principal + 1 VP + 2 section heads + 8 teachers + 100 students at USD 1 each + Chat at USD 50 = **USD 162.00**.

## §3 Modules (brief point 3)

See E9. Rates live in the Billing tab; a module switched off carries no charge.

## §4 Trial reminders (brief point 4)

A sweep (registered through `lib/scheduler.ts` — **no `setInterval`**, see CLAUDE.md) sends,
for each Live school, a reminder **5 days** and **1 day** before `trial_ends_on`:
an email to every active super admin and an in-app super-admin notification. Each
(school, kind, trial_ends_on) is **claimed** by an insert into a reminders table with a
unique key (`… ON CONFLICT DO NOTHING RETURNING`), so seven processes never send twice.

## §5 Invoices (brief points 5, 7)

**Generation.** A sweep generates, on the 1st (Asia/Karachi) and on every later tick
that finds one missing, a **draft** invoice for the previous month for every Live
school with at least one billable day in it (E3). Idempotent by a unique
`(location_id, period_start)`. A **"Generate now"** button on the Billing tab does the
same for one school on demand (same function; it is also how QA exercises it).

Lines: one per role (qty × rate × proration), one per enabled priced module (× proration),
plus carry-forward lines (E7). Snapshot everything on the invoice — rates, counts,
conversion rate, days — so a later settings change never rewrites an old invoice.
Currency conversion: amounts are computed in the billing currency then converted to the
invoice currency at the rate stored on the invoice.

**Invoice screens.** A new top-level **Billing** section in the super admin sidebar:
- `/super-admin/billing` — all invoices, filter by school / status / month; status chips
  Draft, Finalized (Due), Overdue, Paid, Carried forward. No chip or column says "partial".
- `/super-admin/billing/invoices/[id]` — the invoice: lines, discounts editor (draft only,
  up to 3), **Finalize**, **Download PDF**, **Email** (recipient defaulted per E11,
  editable), receipts list, **Record receipt** (amount required, transaction ID required,
  description optional), send log.
- `/super-admin/billing/bank-accounts` — up to **3** Pakistani bank accounts: Bank name,
  Account title, Account number, IBAN (PK + 22, validated), Branch name, Branch code,
  City. No SWIFT/routing fields. Shown on every invoice screen and PDF.

**Receipts.** Recording a receipt, in one transaction: insert the receipt; recompute
received/balance; if cumulative ≥ 80% (E6) mark the invoice cleared (status `paid`),
and if the school is blocked and no *other* finalized invoice is past its grace
uncleared, **unblock** it and email the school admin. The remaining balance is carried
by the next generation (E7).

## §6 Blocking (brief points 6, 7)

A sweep blocks every Live school holding a finalized, uncleared invoice past
`due_date + grace_days` (Asia/Karachi). **Claimed** with a conditional update
(`… WHERE access_blocked_at IS NULL RETURNING`). Emails the school admin on every
block and unblock (manual or automatic). Enforcement:

- Every school portal layout and every `/api/school/**` route refuses a blocked school.
  Put the check where the tenant is already resolved per request (`lib/school-auth.ts`)
  so no route can forget it.
- Blocked users land on `/suspended` — "This school's account is currently suspended.
  Please contact the school administration." The **school admin** instead sees the
  unpaid invoice(s), amount due, due date and the bank accounts, and can download the PDF.
- Super admin is never blocked.

## §7 The central sign-in (brief point 10)

`schoolhub.codexmill.com` (the apex, `app/page.tsx`) becomes one form: **Login ID**
(email; a student may enter their student ID) and **Password**. The PanelChooser goes.

1. Match against `super_admin_users` (bcrypt). Match → super admin session cookie → `/super-admin`.
2. Otherwise Supabase `signInWithPassword` (apex is host-only, so do it server-side
   and **do not rely on the apex cookie**). On success, list the person's memberships:
   `school_users` rows with that `auth_user_id`, `is_active`, school not deleted.
   Blocked/removed memberships do not appear.
3. One membership → hand off to that school's subdomain. More than one → an entity
   chooser (school logo + name) → hand off to the chosen one.
4. **Hand-off** reuses the existing platform-session pattern (`mintSessionForEmail` in
   `lib/supabase-auth.ts`, `app/api/school/auth/platform-session`): a single-use,
   60-second token (claimed, not checked), redeemed on the subdomain, which writes the
   school session cookie and redirects to the portal home for that role.
5. Rate-limit with the existing `lib/auth-throttle.ts`. Wrong credentials give one
   generic message — never reveal whether an ID exists or is a super admin.

Must not make the apex page dynamic by accident (CLAUDE.md): the form is a client
component posting to an API route; the page stays prerendered.

## §8 Brand (brief point 11)

- Replace the product word mark everywhere the *platform* brand shows (landing/sign-in,
  super admin header, sign-in pages, PDF invoice, emails where a logo is used) with
  `public/brand/schoolhub-logo.png` via `next/image`. Product name: **SchoolHub**.
  School portals keep the school's own branding.
- Favicon / apple icon / manifest icons from `schoolhub-mark.png` (resize with `sharp`
  in `app/icon/[size]/route.ts`, or static files).
- `schoolhub-bot.png` on the sign-in page only, subtle: small, to the side on desktop,
  low emphasis, hidden or reduced on a phone. It must not compete with the form.

## §9 More than one super admin (brief point 12)

- Table `super_admin_users`: email (unique, lowercased), name, bcrypt `password_hash`,
  `is_owner`, `permissions` jsonb, `is_active`, audit timestamps.
- `0052`'s apply script seeds the **owner** `haznain666@gmail.com` with the current
  env hash (`SUPER_ADMIN_PASSWORD_HASH` or whatever `lib/super-admin-credentials.ts`
  reads). If the table cannot be reached or is empty, login falls back to the env
  credential **for the owner only** — fail open to the old behaviour, never lock the
  owner out.
- Areas for the permission grid: `schools`, `modules`, `billing` (invoices, rates,
  receipts, bank accounts), `feedback`, `catalogue` (features/roadmap), `super_admins`.
  Each has `c/r/u/d`. The owner implicitly holds everything.
- Only the **owner** may set or change another admin's permissions. Admins holding
  `super_admins` c/u/d may create, edit (name, email, active, reset password) and
  delete other admins **but never the owner**, and never change permissions.
  **No one can delete, deactivate, demote or change the email of the owner** —
  enforced in the API *and* by a DB trigger.
- Every super admin can change **their own** password (current password required).
- The JWT gains the admin's id; every super admin API route re-reads the row (active,
  permissions) per request, so a deactivated admin is out on their next click.
  Middleware stays Edge-only (JWT check); permissions are enforced in the route and page.
- Screen: `/super-admin/admins` (list, create, edit, delete) and a **My account** page
  for the password change.

## §10 Migration `0052` checklist

- New tables (every one **ENABLE ROW LEVEL SECURITY** + **REVOKE ALL … FROM anon, authenticated** — see 0050/0051):
  `super_admin_users`, `school_billing_settings`, `school_role_rates`,
  `school_module_rates`, `platform_invoices`, `platform_invoice_lines`,
  `platform_invoice_discounts`, `platform_invoice_receipts`, `platform_invoice_emails`,
  `platform_bank_accounts`, `billing_reminders`, `school_access_events`, `login_handoff_tokens`
  (or reuse an existing hand-off table if one fits).
- `schools.access_blocked_at timestamptz null` (read on every school request).
- Backfill: a `school_billing_settings` row for every school, environment `sandbox`.
- Backfill: Phase 1 modules on for every school.
- Owner-protection trigger on `super_admin_users`.
- `scripts/apply-0052.mjs` in the house pattern: applies, proves by attempt
  (owner delete refused, a CHECK refused), counts `relrowsecurity = false` in `public` = 0.

## §11 Gates

All fifteen in CLAUDE.md, plus a new **`check-sprint35`** that executes every new
statement against the real schema (the `check-sprint20` pattern), plus unit-style
assertions for proration (E3, including the 11-day case and a 28/29-day February),
discount arithmetic (E10), 80% clearing (E6) and the E2 count.
Add loaders for every new server-fetching page (`check-loaders`). New sweeps through
`registerSweep` only (`check-scheduler`).
