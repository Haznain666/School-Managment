# Release notes — Sprint 7: HR & payroll

**Status:** shipped. Migration `0009_sprint7_hr_payroll.sql`, applied.

> Reconstructed after the fact. See
> [how these were written](README.md#how-these-were-written).

The other half of a school's money: what it pays its staff. Nine tables, two
modules, and the first place in the product where an action is deliberately
irreversible.

---

## What a school gets

**Salary components** (`salary_components`). The parts a salary is built from —
basic, allowances, deductions — defined per school.

**Salary structures** (`staff_salary_structures`). What one member of staff is
paid, component by component, effective from a date. Changing a salary adds a
structure; it does not overwrite the old one, so a payslip run last March still
computes what it computed then.

**Leave** (`leave_types`, `leave_requests`). Leave types the school defines, and
requests through to a decision.

**The staff register** (`staff_attendance`). Attendance for staff, separate from
the student register.

**Payroll** (`payroll_runs`, `payslips`, `payslip_items`, `payslip_sequences`).
Run payroll for a month, review it, approve it, and pay it. Payslip numbers come
from a per-school sequence.

**Screens.** HR overview, staff (list and detail), salary components, leave, the
staff register, payroll runs, a run's detail, and a payslip.

---

## Things worth knowing

- **Approving a payroll run cannot be undone.** That is why `payroll.write` is a
  separate permission from `payroll.read`: seeing what staff cost is a head's
  job, computing and approving it is HR's. Sprint 8 made that split
  configurable per school.
- **A payslip is a document, not a view.** It prints through the shared print
  framework with the school's letterhead.

---

## What later sprints added here

- Sprint 8 turned the hard-coded role abilities into **per-school permissions**,
  including the `hr.*` and `payroll.*` keys.
- The school-admin dashboard shows staff cost alongside collection, and
  **deliberately shows profit as unavailable** rather than estimating it — the
  accounting ledger it needs is a later sprint (Sprint 10.5's dashboard work).

---

## Not in this release

- Statutory tax or provident-fund calculation.
- Bank-file export for salary disbursement.
- Any accounting ledger. Payroll knows what it paid; nothing yet reconciles that
  against income.
