# Release notes — Sprint 5: Fee management

**Status:** shipped. Migration `0007_sprint5_fee_management.sql`, applied.

> Reconstructed after the fact. See
> [how these were written](README.md#how-these-were-written).

Billing. What each class pays, the challans that bill it, the payments that
settle them, and the paper a parent takes to the bank.

---

## What a school gets

**Fee heads** (`fee_types`). What the school bills under — tuition, admission,
annual charges, library, examination — each monthly, one-off or annual.

**The price list** (`fee_structures`). What every class pays under every head,
for one academic year. Re-priced per year, so last year's challans keep the
price they were raised at.

**Concessions** (`student_concessions`). Sibling, staff and hardship discounts,
per student, effective over a period.

**Challans** (`fee_challans`, `fee_challan_items`). Raise a bill for one student
or a whole class, itemised by head, with a due date and a challan number issued
from a per-school sequence (`challan_sequences`) so numbers cannot collide.

**Payments** (`fee_payments`). Record what came in, in part or in full; the
challan's status follows from what it has been paid.

**Late fees** (`late_fee_rules`).

**Printing.** Challans print through the shared print framework with the
school's letterhead, singly or in bulk from the challan list.

**Screens.** Fee overview, types, structures, concessions, challans (list,
detail, generate, record payment, bulk print), reports and settings.

---

## Things worth knowing

- **Money is stored as `numeric`, never as a float**, and summed in the database.
  A rounding error in a challan is a dispute with a parent, not a display bug.
- **A cancelled or waived challan is not outstanding.** It is excluded from what
  a school is owed rather than sitting as a permanent debt.
- **Bulk printing is capped** at 200 challans in one sheet.

---

## What later sprints added here

- **Family / sibling vouchers** — one total for a parent with three children —
  and a **defaulter list with aging buckets**, both Sprint 10.
- **Charts** on the fee overview: billing status, outstanding by age, collection
  by month (Sprint 10.5).
- The **print regression check** in Sprint 10.5 exists because of this module —
  a print change once shipped blank challans for two days.

---

## Not in this release

- Online payment. JazzCash and Easypaisa are a later sprint, and their merchant
  onboarding is the longest-lead item in the plan.
- Any accounting ledger. Profit is deliberately shown as unavailable on the
  dashboard rather than estimated.
