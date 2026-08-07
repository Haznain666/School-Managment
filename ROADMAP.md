# Product roadmap — gap analysis against OurSchoolSoftware

**Written:** 2026-08-07
**Purpose:** what to build next, and why, to reach feature parity with the
closest Pakistani competitor.

---

## Where this came from, and its limits

The comparison target is **OurSchoolSoftware** (ourschoolsoftware.com), which
markets itself as "Pakistan's No. 1 School Management System". It was identified
from a 37-minute demo video the user supplied
(`youtu.be/Xiu8PA_eeVQ`).

**The video itself was not watched — that is not something I can do.** The
module list below comes from the vendor's own website, which advertises the same
product. The video description carried no chapter markers to work from.

So this is *"compared against what they advertise"*, not *"compared against what
was demonstrated on screen"*. Anything shown in the video but absent from their
marketing site is missing here. Worth a second pass by someone who has watched
it.

Effort figures are rough, for one developer familiar with this codebase, and
exclude design and QA.

---

## 1. Where we already stand

Stronger than the comparison suggests at first glance.

| Their module | Ours |
| --- | --- |
| Admission Management | ✅ Built, including a public application form |
| Multi-Campus Management | ✅ Built — `branches`, scoped per user |
| Role-based portals | ✅ **Ahead** — 11 roles plus a per-school permission matrix |
| Student attendance | ✅ Built |
| Staff attendance | ✅ Built |
| Fee Collection | ✅ Built — challans, concessions, late-fee rules, part payments |
| Customisable system | ✅ Built — per-school module toggles |
| Domain / subdomain | ✅ Built |
| WhatsApp alerts | ✅ Built via GoHighLevel (**currently being removed — see §4**) |

**Not on their list at all, and ours:** HR and payroll — leave management,
salary structures, payslip generation, staff attendance feeding loss-of-pay.
That is a real differentiator against this competitor and should be said out
loud in sales material.

---

## 2. The gaps

### Tier 1 — cannot credibly sell without these

**1. Exam management — ~10–15 days**
Nothing exists today. Needs: exam terms, exam schedules per grade/section,
subject-wise maximum and passing marks, marks entry per student, grading
schemes (A/B/C bands, GPA), and re-sit handling.

New tables: `exam_terms`, `exams`, `exam_subjects`, `exam_results`,
`grading_schemes`. Follow the tenancy pattern in `db/schema/attendance-records.ts`
— every table carries `location_id` and is indexed on it.

*Why first:* a school's academic year is organised around exams. Everything in
Tier 1 below depends on this existing.

**2. Result cards / marksheets — ~5–8 days** *(depends on #1 and #3)*
Per-student report card: subject marks, totals, position in class, grade,
attendance summary, remarks. Printable and shareable.

*Why:* this is the artefact parents judge the entire system by.

**3. Printable documents — ~8–12 days for the framework, then ~1 day each**
**There is no PDF or print layer in the codebase at all.** This is the most
structural gap. The competitor advertises ten document types: fee vouchers,
thermal-printer vouchers, fee receipts, student ID cards, marksheets, leaving
certificates, experience certificates, birthday cards, family fee reports,
parent vouchers.

A Pakistani school office runs on printed paper — the fee voucher a parent
carries to a bank counter *is* the core fee workflow, and today we cannot
produce one.

Suggested approach: server-rendered HTML templates → PDF, with per-school
branding pulled from `school_branding` (logo and colours already exist).
Thermal-printer output is a separate narrow width template, not an afterthought.

### Tier 2 — strong commercial differentiators

**4. Digital payments — ~10–15 days**
JazzCash and Easypaisa first, cards later. Today the system only *records* that
a payment happened; it cannot take one. Needs a payments gateway abstraction,
webhook handling, and reconciliation against `fee_challans`.

Note: `fee_payments` already stores `payment_method` and `reference_number`, so
the data model mostly accommodates this already.

**5. Family / sibling fee grouping — ~3–5 days**
Fees are strictly per-student. A parent with three children wants one voucher
and one total. Cheap to build, disproportionately liked, and directly
advertised by the competitor ("Family Fee Report", "Parent Voucher").

`student_guardians` already links guardians to students — the grouping key
exists.

**6. SMS alerts — ~3–5 days**
No SMS channel exists. Straightforward given the existing sender abstraction in
`lib/otp-sender.ts` and `lib/invite-sender.ts`.

**7. Full accounting — ~15–20 days**
Income and expenses beyond fees, expense categories, vendor payments, a general
ledger, and income/expense reporting. Without it schools keep separate books,
which undercuts the "one system" pitch.

### Tier 3 — larger or hardware-dependent

**8. Biometric / device attendance — ~15–25 days**
Fingerprint and face-ID devices, barcode ID-card scanning, webcam capture.
Requires hardware integration and on-premise device connectivity. Heavily
marketed by the competitor.

**9. Mobile apps (Android / iOS) — ~30–45 days**
Currently web-only. The competitor ships one app serving all roles.

**10. Bundled school website — ~8–12 days**
They include a free school website with each subscription.

---

## 3. Suggested build order

1. **Exams → marks entry → result cards**, together as one connected push.
   Nothing else unlocks as much value.
2. **The printing framework.** Once one PDF template exists, the other nine are
   roughly a day each. Do fee vouchers first — they are used daily.
3. **Digital payments** — JazzCash and Easypaisa.
4. **Family fee grouping.** Small, and schools ask for it constantly.
5. Accounting, SMS, biometric, mobile apps — after paying schools tell you
   which they actually want. Do not guess this far ahead.

---

## 4. A strategic caution

The competitor's marketing leads with **WhatsApp alerts, SMS alerts and
biometric attendance**. Their positioning is built on reaching parents where
parents already are.

We are currently removing WhatsApp entirely (see `STATE.md`).

The email *login* decision is sound and simplifies the system considerably.
**The notification decision is the risky half.** In this market a fee reminder
over WhatsApp gets read; the same reminder by email frequently does not arrive
at all — many parents have no email address, and `student_guardians.email` is
nullable, which hints it is often empty in practice.

**Recommendation: email for authentication, WhatsApp for parent
communication.** That keeps the simpler login and does not concede the
competitor's main selling point.

This needs deciding before the WhatsApp removal work starts, because switching
it back on afterwards is more expensive than not removing it.

---

## 5. What this does not cover

The competitor's site does not mention library, transport, hostel or inventory
management. Those are common in school ERPs and may well appear in the video or
in competing products. Not assumed here, because there was no evidence for
them — worth checking before planning a second phase.
