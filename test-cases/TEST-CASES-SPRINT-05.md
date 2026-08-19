# Test cases — Sprint 5: Fee management

Traces to [`RELEASE-NOTES-SPRINT-05.md`](../release-notes/RELEASE-NOTES-SPRINT-05.md).
Migration `0007_sprint5_fee_management.sql`.

**Every case here is P1 or close to it.** The note's own justification: "A
rounding error in a challan is a dispute with a parent, not a display bug."
Money cases are not graded by how hard they are to hit — a defect that shows up
once in four hundred challans still reaches a parent at a bank counter.

**The print regression is not hypothetical.** Sprint 10.5 records that "a print
change once shipped blank challans for two days". UC-S05-11 exists because of
that, and it should be run on any release touching print or theming, not only
on fee releases.

---

## The price list

#### UC-S05-01 · Fee heads carry their frequency — P2
**Role** Accountant · **Traces to** "tuition, admission, annual charges, library, examination — each monthly, one-off or annual"
1. Create a head of each frequency; raise challans that should include them.
- **Expect** a monthly head recurs, a one-off does not, an annual appears once in the year.

#### UC-S05-02 · Last year's challans keep last year's prices — P1
**Role** Accountant · **Traces to** "Re-priced per year, so last year's challans keep the price they were raised at"
1. Raise a challan in year 1. Re-price the same head upward for year 2.
2. Reopen and reprint the year 1 challan.
- **Expect** the original amount, on screen and on paper.
- **Fail** if it now shows the new price. A reprinted challan that disagrees with the one a parent already paid is a dispute the school cannot win.

#### UC-S05-03 · Concessions apply over their effective period only — P1
**Role** Accountant · **Traces to** "per student, effective over a period"
1. Give a student a concession effective for one term. Raise challans inside and outside it.
- **Expect** discounted inside, full price outside.
- **Fail** if it applies to every challan ever — a sibling discount that never ends is money the school stops billing.

---

## Challans

#### UC-S05-04 · Challan numbers cannot collide — P1 · **NEEDS TENANCY**
**Role** Accountant at two schools · **Traces to** "a challan number issued from a per-school sequence (`challan_sequences`) so numbers cannot collide"
1. Bulk-generate for a whole class at each of two schools, concurrently if possible.
- **Expect** every number unique within its school and carrying its school's prefix.
- **Fail** on a duplicate or a gap-per-failed-attempt pattern (see UC-S04-04 for the same failure mode on student IDs).

#### UC-S05-05 · A challan is itemised by head with a due date — P2
**Role** Accountant · **Traces to** "itemised by head, with a due date"
1. Raise a challan spanning several heads.
- **Expect** each head on its own line, the total equal to their sum, and a due date.
- **Fail** if the total is not exactly the sum of the lines.

#### UC-S05-06 · Bulk generation covers a whole class — P2
**Role** Accountant · **Traces to** "Raise a bill for one student or a whole class"
1. Generate for a class of 40.
- **Expect** 40 challans, each priced for that student including their concessions.

---

## Payments and status

#### UC-S05-07 · Partial payment leaves the right balance — P1 · **NEEDS SEED**
**Role** Accountant · **Traces to** "Record what came in, in part or in full; the challan's status follows from what it has been paid"
1. Record a part payment against a challan, then the remainder.
- **Expect** the status moves partial → paid, and the balance is exact at each step.
- **Fail** on any rounding drift. Money is "stored as `numeric`, never as a float, and summed in the database" — a float would show here first.

#### UC-S05-08 · A cancelled or waived challan is not outstanding — P1
**Role** Accountant · **Traces to** "It is excluded from what a school is owed rather than sitting as a permanent debt"
1. Note the outstanding total. Cancel one challan and waive another.
2. Re-read the total, the defaulter list, and the outstanding-and-aging report.
- **Expect** both amounts removed from all three.
- **Fail** if either lingers as debt — the school would chase a parent for money it has already written off.

#### UC-S05-09 · Late fee rules apply as configured — P2
**Role** Accountant · **Traces to** "`late_fee_rules`"
1. Configure a rule; let a challan pass its due date.
- **Expect** the late fee applies per the rule and appears as its own line, not folded silently into tuition.

#### UC-S05-10 · Billed − Collected equals Outstanding — P1 · **NEEDS SEED**
**Role** Accountant · **Traces to** Sprint 12: "so Billed − Collected is exactly Outstanding"
1. Run the fee collection report and the outstanding-and-aging report over the same range.
- **Expect** the arithmetic ties exactly.
- **Fail** on any discrepancy — two independently written queries disagreeing about the same money is the most reportable defect in the product.

---

## Printing

#### UC-S05-11 · A challan prints, and is not blank — P1 · **NEEDS PAPER**
**Role** Accountant · **Traces to** "a print change once shipped blank challans for two days"
1. Print one challan to real A4.
2. Repeat with **background graphics enabled** and with a school on a **dark** palette.
- **Expect** readable on paper, with the school's letterhead, and **not** a dark sheet. Sprint 10.5 caught exactly that regression before it shipped.
- **Fail** on blank output, missing letterhead, or dark ink coverage.

#### UC-S05-12 · Bulk printing is capped at 200 — P2
**Role** Accountant · **Traces to** "Bulk printing is capped at 200 challans in one sheet"
1. Select more than 200 and print.
- **Expect** the cap is applied and **stated**, not silently truncated.
- **Fail** if 250 selected yields 200 printed with no message — the office would post 50 fewer challans than it believes.

#### UC-S05-13 · Screen and paper come from one query — P1 · **NEEDS PAPER**
**Role** Accountant · **Traces to** the cross-sprint rule, stated for report cards in Sprint 13: "the same component, from the same query, so a figure a parent reads on screen cannot differ from the one on the paper in their hand"
1. Compare a challan on screen with its printed sheet, figure by figure.
- **Expect** identical.

---

## Family vouchers and defaulters

#### UC-S05-14 · A family voucher can be issued **and paid** — P1 · **NEEDS SEED**
**Role** Accountant · **Traces to** Sprint 10: "a family voucher could be issued but not paid, so the queueing the feature exists to remove came straight back"
1. Issue a family voucher for a guardian with three children. Record one payment against it.
- **Expect** payment is accepted and settles across the children.
- **Fail** if payment is impossible — a documented regression, and it defeats the whole feature.

#### UC-S05-15 · The defaulter list buckets by age — P2 · **NEEDS SEED**
**Role** Accountant · **Traces to** "Who is overdue and by how long, in aging buckets"
1. With overdue challans of different ages, open the defaulter list.
- **Expect** each in the right bucket; cancelled and waived excluded (UC-S05-08).

#### UC-S05-16 · Fee charts agree with the fee screens — P2
**Role** Accountant · **Traces to** Sprint 10.5: "billing status, outstanding by age, collection by month"
1. Compare each chart against the report holding the same figures.
- **Expect** they agree. A chart contradicting the document beside it is the failure mode Sprint 9 and 10.5 both designed against.

---

## Not in this release

- **Online payment** (JazzCash, Easypaisa) — a later sprint, and "their merchant
  onboarding is the longest-lead item in the plan".
- **Any accounting ledger.** Profit is "deliberately shown as unavailable on the
  dashboard rather than estimated". Do not report the missing profit figure as a
  defect.
