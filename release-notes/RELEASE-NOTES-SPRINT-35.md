# Release notes — Sprint 35: invoicing, one sign-in, and a team of operators

**Date:** 25 September 2026
**Migration:** `0052` (thirteen new tables, one new column on `schools`).
**Status:** built and gated. **Not yet applied or deployed** — see `PENDING.md` N2.

## New for the platform operator

### Billing, per school

Every school has a new **Billing** tab:

- **Sandbox or Live.** Every existing school starts in Sandbox, where nothing is
  ever invoiced, reminded or blocked. Switching a school to Live asks first and
  shows the date it will count from.
- **Currencies.** Rates in US dollars or rupees, invoices in either, with a
  USD → PKR rate whenever the two differ.
- **Trial and grace.** A free trial in days from the day the school goes Live,
  and a grace period after each due date (two days unless you change it).
- **Rates** per user for every role except parents, and per module for every
  paid module the school has switched on — with the live head count, each
  line's total, and the monthly estimate underneath.
- **Access.** Active or Blocked, with Block and Unblock buttons. The school
  administrator is emailed either way.

### Invoices

- Raised automatically on the **1st of each month for the month before**,
  prorated by day for a school that went live or left its trial part-way
  through. A **Generate now** button does the same for one school.
- Up to **three discounts** per invoice, then **Finalize**.
- **Download PDF**, and **Email** it — to the school's remembered address by
  default, or anyone else, and the address you use becomes the new default.
- **Record receipt** with the amount and the bank's transaction ID.
- Any balance left on an invoice is **carried to the next one**.
- A new **Billing** section lists every invoice from every school, filtered by
  school, status and month, and holds the platform's own **bank accounts** (up
  to three, Pakistani IBANs), which are printed on every invoice.

### Suspension

A Live school whose finalized invoice is still unpaid after the due date (the
10th) and its grace period is **suspended**: staff, students and parents see a
notice asking them to contact the school administration. The **school
administrator** instead sees what is owed, when it was due, where to pay it,
and can download the invoice. Access returns when payment is recorded, or when
you unblock the school by hand.

### Trial reminders

Five days and one day before a school's trial ends, every operator gets an email
and a notification in the panel's bell.

### Users per school

The Schools list has a **Users** column — every active member except parents —
and clicking it shows the count by role.

### Modules

**Admissions, Fee Management and Academics** are now **Included** with every
school and can no longer be switched off.

### More than one super admin

- **Super admins** lists everyone who can sign in to the panel. The owner holds
  everything and cannot be removed, deactivated or given a different email.
- Each other operator gets **Create / View / Edit / Delete** per area — Schools,
  Modules, Billing, Feedback, Features & Roadmap, Super admins — and **only the
  owner** can change those.
- **My account** lets every operator change their own password.

## New for everybody

### One sign-in

The SchoolHub home page is now a single sign-in: a **Login ID** (your email, or a
student ID) and a **password**. Operators go to the panel; everybody else is
taken to their own school, or asked to choose if they belong to more than one.
Each school's own sign-in page still works exactly as before.

### The SchoolHub brand

The new SchoolHub logo on the home page, the operator sign-in and the panel; the
SchoolHub mark as the platform's icon; and a small, quiet robot beside the
sign-in form on larger screens. Schools keep their own logo and colours.
