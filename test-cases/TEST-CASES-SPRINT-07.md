# Test cases — Sprint 7: HR & payroll

Traces to [`RELEASE-NOTES-SPRINT-07.md`](../release-notes/RELEASE-NOTES-SPRINT-07.md).
Migration `0009_sprint7_hr_payroll.sql`.

**"The first place in the product where an action is deliberately
irreversible."** Approving a payroll run cannot be undone. Test the guard
(UC-S07-06) before testing anything that would trip it, and use a throwaway
month — there is no undo to fall back on if a case goes wrong.

**Salary history is add-only, for the same reason challan prices are frozen:**
"a payslip run last March still computes what it computed then."

---

## Salary structures

#### UC-S07-01 · A salary is built from the school's own components — P2
**Role** HR manager · **Traces to** "basic, allowances, deductions — defined per school"
1. Define components of each kind; build a structure from them.
- **Expect** the payslip total is basic + allowances − deductions, exactly.

#### UC-S07-02 · Changing a salary adds a structure, never overwrites — P1
**Role** HR manager · **Traces to** "Changing a salary adds a structure; it does not overwrite the old one, so a payslip run last March still computes what it computed then"
1. Run and approve payroll for March. Raise the member's salary effective April.
2. Reopen March's payslip.
- **Expect** March still shows the old figure.
- **Fail** if March follows the new salary. A payslip that changes after it was issued is the software telling somebody something untrue about money they have already been paid.

#### UC-S07-03 · Effective dates decide which structure applies — P1
**Role** HR manager · **Traces to** "effective from a date"
1. With structures effective January and April, run payroll for February and May.
- **Expect** February uses the January structure, May the April one.

---

## Leave and the staff register

#### UC-S07-04 · Leave types are the school's own, and requests reach a decision — P2
**Role** HR manager · **Traces to** "Leave types the school defines, and requests through to a decision"
1. Define a type; raise a request; approve one and reject another.
- **Expect** both decisions recorded with the school's note.

#### UC-S07-05 · The staff register is separate from the student register — P1
**Role** HR manager · **Traces to** "Attendance for staff, separate from the student register"
1. Mark staff attendance. Open the student register for the same day.
- **Expect** no bleed in either direction; the attendance reports for students exclude staff entirely.

---

## Payroll — the irreversible one

#### UC-S07-06 · Approving a payroll run cannot be undone — P1
**Role** HR manager · **Traces to** "Approving a payroll run cannot be undone"
1. On a **throwaway month**, create and approve a run.
2. Look for any way to reverse, delete or re-open it.
- **Expect** none exists, and the interface warned before approval.
- **Fail** if approval is silent. An irreversible action that does not announce itself is worse than a reversible one.

#### UC-S07-07 · `payroll.read` and `payroll.write` are genuinely separate — P1
**Role** Principal (read), HR manager (write) · **Traces to** "seeing what staff cost is a head's job, computing and approving it is HR's"
1. As a role holding `payroll.read` only, open payroll and attempt to compute and approve.
- **Expect** the figures are visible; both actions are refused, on screen **and** by the route.
- **Fail** if the button is merely hidden — post the request directly.

#### UC-S07-08 · Payslip numbers come from a per-school sequence — P1 · **NEEDS TENANCY**
**Role** HR manager at two schools · **Traces to** "Payslip numbers come from a per-school sequence"
1. Run payroll at both schools.
- **Expect** no collision; each carries its school's prefix.

#### UC-S07-09 · The run walks compute → review → approve → paid — P2
**Role** HR manager · **Traces to** "Run payroll for a month, review it, approve it, and pay it"
1. Walk all four states.
- **Expect** the order is enforced; a state cannot be skipped.

#### UC-S07-10 · A payslip prints as a document on the school's letterhead — P2 · **NEEDS PAPER**
**Role** HR manager · **Traces to** "A payslip is a document, not a view. It prints through the shared print framework with the school's letterhead"
1. Print a payslip to real A4.
- **Expect** letterhead, readable, figures identical to the screen. Run the dark-palette and background-graphics variants from UC-S05-11.

#### UC-S07-11 · A teacher sees their payslip only once the run is **paid** — P1
**Role** Teacher · **Traces to** Sprint 13: "Payslips appear once a payroll run has been **paid** — never while it is still being computed, because a figure that then changes on payday is the software telling somebody something untrue about their salary"
1. Compute and approve a run without paying it. Open the teacher's *My payslips*.
2. Mark it paid; look again.
- **Expect** absent until paid, then present.
- **Fail** if a computed-but-unpaid figure is visible to staff.

#### UC-S07-12 · A teacher sees their own leave record, and cannot apply — P2
**Role** Teacher · **Traces to** Sprint 13: "**Applying** for leave is still done through the office. What a teacher gets here is the record"
1. Open *My leave*.
- **Expect** what was applied for, what was decided, the school's note — and **no apply form**.
- **Fail** if an apply form exists. Its absence is deliberate: "shipping a form that half-answered them would put applications into a queue nobody had agreed how to work."

#### UC-S07-13 · Staff cost appears on the dashboard, and profit does not — P2
**Role** School administrator · **Traces to** "the school-admin dashboard shows staff cost alongside collection, and **deliberately shows profit as unavailable** rather than estimating it"
1. Open the dashboard.
- **Expect** staff cost and collection shown; profit explicitly **unavailable**, not blank and not estimated.
- **Fail** if a profit figure is computed from these two. It would be wrong, and it would be believed.

---

## Not in this release

- Statutory tax or provident-fund calculation.
- Bank-file export for salary disbursement.
- Any accounting ledger — "Payroll knows what it paid; nothing yet reconciles
  that against income." Sprint 13.5.
