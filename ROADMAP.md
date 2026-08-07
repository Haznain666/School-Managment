# Product roadmap — gap analysis against OurSchoolSoftware

**Written:** 2026-08-07
**Purpose:** what to build next, and why, to reach feature parity with the
closest Pakistani competitor.

---

## Where this came from, and its limits

The comparison target is **OurSchoolSoftware** (ourschoolsoftware.com), which
markets itself as "Pakistan's No. 1 School Management System", from a 37-minute
demo video (`youtu.be/Xiu8PA_eeVQ`).

**The video itself was not watched — that is not something I can do.** Two
sources stand in for it:

1. The vendor's own website (their advertised module list).
2. **A module and feature directory the user extracted from the video itself**
   via NotebookLM. This is the better source — it covers ten modules with
   features, stakeholders, reporting and integrations, and it surfaced several
   things the marketing site never mentions. §2b comes from it.

Between the two this is now a fair picture. It is still second-hand: anything
demonstrated on screen but absent from both sources is missing here.

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

**3. Printable documents — framework BUILT 2026-08-07; ~1 day per new document**

*Correction: an earlier draft of this file claimed there was no print layer at
all. That was wrong — a three-copy A4 fee voucher already existed. What was
missing was that it was a one-off rather than a framework, and that bulk
printing did not exist.*

Now built (`components/print/PrintSheet.tsx`):
- `PrintSheet` — owns page size, margins, break behaviour and hiding the portal
  shell. A4, A4 landscape and 80mm thermal.
- `PrintDocument` / `PrintLetterhead` — per-document framing and the branded
  masthead, with the school logo from `school_branding` (previously unused).
- Generic `@media print` rules keyed off `[data-print-root]`, so a new document
  type inherits all of it.
- **Bulk challan printing** at `dashboard/fees/challans/print?ids=…` — one
  sheet per student, three copies each, one print job. Bulk *generation* already
  existed; without this it was unusable at 400 students.

No PDF dependency: the browser's print dialog is the renderer, and "Save as PDF"
is built into it. That is deliberate — Hostinger runs a plain Node process on
shared infrastructure, where headless Chromium is unreliable at best.

**Still to build on top of it**, roughly a day each: fee receipt, thermal
receipt, student ID card, admit card, marksheet, leaving certificate,
experience certificate, family/parent voucher.

Known limits, written up in the page itself: capped at 200 challans per job
(one query per challan, and print dialogs fail past a few hundred pages), and it
needs "Background graphics" enabled in the print dialog for rules and cut lines.

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

## 2b. Additional gaps from the video's module directory

These appear in the user's extracted directory but not on the marketing site.
Several are small and high-value; two are whole modules nobody had counted.

**Whole modules we do not have at all**

| Module | Their features | Effort |
| --- | --- | --- |
| **E-Learning & Homework** | Homework diary, study material sharing (video/PDF/image), online class links, live application submission | ~12–18 days |
| **Stock & Inventory (POS)** | Point of sale, barcode product scanning, sales profit tracking, low-stock and out-of-stock alerts, purchase-vs-sale reports | ~15–20 days |
| **Communication Management** | Notice board, push notifications, message history and delivery logs, alongside SMS/WhatsApp/email | ~8–12 days |

The POS module is for school shops — uniforms, books, stationery. Whether that
matters depends entirely on whether your target schools run one. Worth asking
before costing it seriously.

**Small features, disproportionate value**

| Feature | Why it matters | Effort |
| --- | --- | --- |
| **Promote students to next class** | Every school does this once a year, for every student. Doing it by hand is unthinkable. **Biggest omission on this list.** | ~4–6 days |
| **Campus transfer** | Move a student between branches keeping their history. We have branches but no transfer path. | ~2–3 days |
| **Excel bulk import of students** | How a school onboards year one. Without it, adoption means typing 800 students in by hand. | ~4–6 days |
| **Parent Wallet** | Advance/credit balance carried against future fees. Common in Pakistani schools. | ~5–8 days |
| **Fee defaulter lists** | The report an accountant actually opens each morning. | ~2–3 days |
| **Subject-wise attendance** | Ours is per-day only; theirs is per-lecture. Needed for secondary schools. | ~5–8 days |
| **Admit cards** | Printed per student per exam. Cheap once exams exist and the print framework is in place. | ~1–2 days |
| **Tabulation sheets & position holders** | Class-wide result grids and rankings — what a principal reviews after exams. | ~3–5 days |
| **Staff loans & instalments** | Salary advances recovered over months. Payroll already exists, so this is an extension. | ~4–6 days |
| **Gatekeeper role** | A gate-scanner account that can only mark attendance. Our permission matrix already supports this shape. | ~1–2 days |
| **Teacher performance tracking** | Advertised; unclear what it measures. Needs discovery before costing. | unknown |

**Already covered by us:** ID card generation *(needs a template on the new print
framework)*, character and leaving certificates *(same)*, timetable, marksheet
*(needs exams first)*, income/expense reporting *(needs accounting)*.

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

## 4. WhatsApp — settled 2026-08-07

Earlier drafts of this file warned against removing WhatsApp outright, since the
competitor's whole positioning rests on it. **The user has settled it, and the
answer is better than either extreme:**

- **Email is the primary channel.** Login, signup OTP, and all notifications
  work over email for every school, with no WhatsApp dependency anywhere in the
  critical path. A school that never pays for WhatsApp is fully functional.
- **WhatsApp becomes a paid add-on, enabled per school by the Super Admin.**
  "Connect WhatsApp" appears against each school in the Super Admin panel.
  Schools willing to pay for it get it.
- **Build the routes now, keep them dormant.** The plumbing goes in during the
  main build rather than being retro-fitted, but nothing depends on it.

**Why this is the right shape.** It turns the competitor's headline feature into
a revenue line instead of a cost, and it removes the risk that worried me — a
parent with no email address is a support problem, but a school with no
WhatsApp budget is still a working customer.

**Implementation note.** `school_modules` already exists for exactly this: it is
the per-school feature-toggle table the module switches use today. WhatsApp
should be a flag there, not a new mechanism. The existing GoHighLevel client
(`lib/ghl-client.ts`, `lib/ghl-fees.ts`, `lib/invite-sender.ts`,
`lib/otp-sender.ts`) already contains the send paths — they need gating behind
the flag with an email fallback, not deleting.

This supersedes the "comment out all WhatsApp code" instruction recorded in
`STATE.md`. Gate it, do not comment it out.

---

## 5. What this does not cover

The competitor's site does not mention library, transport, hostel or inventory
management. Those are common in school ERPs and may well appear in the video or
in competing products. Not assumed here, because there was no evidence for
them — worth checking before planning a second phase.
