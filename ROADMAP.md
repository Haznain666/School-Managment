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

**On the effort figures.** The day counts throughout this document are
traditional estimates — one human developer, writing the frontend, backend and
migrations by hand. They are the right unit for comparing items against each
other, and the wrong unit for predicting when this ships. See §7 for what the
calendar actually looks like.

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

**POS is confirmed in scope (2026-08-07).** Most target schools sell their own
books, stationery and uniforms, so the shop is a real part of how they operate —
and it ties into fees, since purchases are often billed to the student account
rather than paid in cash. Treat `student_id` as a first-class payment method in
the POS, not an afterthought.

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

## 5. Internal chat — replaces WhatsApp entirely (decided 2026-08-07)

Supersedes §4. WhatsApp is not a paid add-on either; it is **replaced** by chat
built into the CRM. No Twilio, no WhatsApp Business API, no per-message cost,
no dependence on a phone network. Phone numbers stay a required field on
students and parents as a contact record — they are simply not a delivery
channel.

### Why we build it rather than integrate one

I looked at the established self-hosted options. **None of them fit**, and the
reason is the same in every case: they are separate servers with their own
stacks — Rocket.Chat is Node + MongoDB, Mattermost is Go, Zulip is Python,
Element is a Matrix homeserver. Embedding any of them means running a second
backend, a second user directory, and a second permission model that would have
to be kept in step with `school_users` and the per-school permission matrix.
The permission rules below are unusual enough that none of them could express
them anyway.

**Supabase Realtime already does the hard part**, and we are on Supabase
already. It gives Postgres Changes (live message delivery), Presence
(online/typing) and private channels authorised by RLS policies — so a
conversation a user is not a participant in is not merely hidden in the UI, the
database refuses to stream it. Attachments and voice notes go to Supabase
Storage, which is already wired up. **Zero new infrastructure.**

### Permission model

The rules the user specified, plus what falls out of them:

| Who | May start a conversation with |
| --- | --- |
| Staff (any role) | Any other staff member |
| Staff | Any parent, any student |
| Parent | Only teachers who teach one of their own children |
| Student | **Nobody by default** — may only reply to a chat a teacher started |
| Student, where the teacher has opted in | That teacher |

Teachers get a per-teacher setting: *allow students to start a chat with me*,
default **off**. This is a `chat_settings` row, not a global school policy —
one teacher opting in must not opt in the rest.

"Teachers of their children" is derivable today: `student_guardians` →
`student_enrollments` → `sections` → the teaching assignments in
`timetable_entries`. No new relationship is needed.

### Data model

```
chat_conversations   id, location_id, kind (direct|group|announcement),
                     title, created_by, branch_id, created_at, archived_at
chat_participants    conversation_id, school_user_id, role (owner|member),
                     joined_at, last_read_at, muted_until
chat_messages        id, location_id, conversation_id, sender_id,
                     kind (text|voice|image|file), body, attachment_path,
                     duration_ms, reply_to_id, created_at, edited_at,
                     deleted_at, deleted_by
chat_settings        school_user_id, students_may_initiate, quiet_hours_from,
                     quiet_hours_to
chat_reports         message_id, reported_by, reason, created_at, resolved_at
```

Every table carries `location_id` and is indexed on it, per the tenancy rules.

### Suggested improvements

Offered as recommendations, not decided:

1. **Announcement channels.** One-to-many, recipients read-only. A class notice
   to 400 parents should not be a group chat with 400 people who can all reply
   to each other. Same table, `kind = 'announcement'`.
2. **Safeguarding: school admins can read conversations involving students.**
   Not optional in my view — a school is legally responsible for what adults say
   to children on a platform it runs. Make it visible rather than covert: the
   participants should be told that staff–student chats are reviewable. This is
   also why students should not be able to hard-delete messages.
3. **Quiet hours.** A teacher should not get parent messages at 11pm. Messages
   still send; notification is deferred until morning.
4. **Report a message.** One tap, goes to the school admin. `chat_reports`
   above.
5. **Rate limits.** A parent in dispute with a school can otherwise send 500
   messages in a night.
6. **Retention policy per school.** Some schools will want chat purged yearly.
7. **Context links.** Start a chat from a student's profile, attach a fee
   challan to a message. This is the advantage an in-CRM chat has over WhatsApp,
   and it is worth leaning on.
8. **No message deletion for parents and students**, soft delete with audit for
   staff. Deleted-message-shaped holes in a safeguarding record are a problem.

### ⚠️ The real risk: reach

WhatsApp works because it is already on the parent's phone and it notifies them.
An internal chat only works if the parent opens our app. **If a fee reminder
sits unread in a chat inbox nobody opens, collections suffer** — and that is the
exact failure I flagged when email-only was proposed.

Mitigations, in order of importance:

1. **Web Push notifications via PWA.** This is the one that makes the decision
   safe. It puts a real notification on the parent's phone, works on Android and
   iOS 16.4+, needs no phone number, no app store, and costs nothing. **Treat
   this as part of the chat build, not a follow-on.**
2. **Email digest fallback** for anyone without push enabled.
3. **Unread badge** on the parent portal, and unread counts in any email.

Without push, this replaces a channel parents read with one they do not. With
push, it is genuinely better than WhatsApp — threaded, searchable, tied to
student records, and free.

### Build order

1. Data model + RLS policies + the permission resolver.
2. Direct messages, text only, staff↔staff. Proves the realtime layer.
3. Parent and student rules, plus the teacher opt-in setting.
4. Groups and announcement channels.
5. Attachments, then voice notes (`MediaRecorder` in the browser → Storage).
6. **Web Push / PWA.**
7. Moderation: reports, admin review, retention.

---

## 6. Realistic timeline

The day figures above are human-developer estimates. They are not what this
will take, and it is worth being precise about why — in both directions.

**What gets much faster.** Writing the schema, migrations, API routes, queries
and UI for a well-specified module is hours, not days. The print framework in
§2 Tier 1.3 was estimated at 8–12 days and took about an hour. A module like
POS, where the shape is well understood, is realistically **one working session
for a solid first cut**.

**What does not get faster, and now dominates:**

- **Deciding what it should do.** Nobody can compress this. Should POS bill to
  a student account or take cash only? Do you stock by size for uniforms? These
  are your answers, not mine, and getting them wrong costs more than the build.
- **Your review.** Every module needs you to look at it and say what is wrong.
- **Testing against reality.** A fee voucher that looks right on screen and is
  rejected at a bank counter is not finished. This needs a real school.
- **Iteration.** First cuts are 80% right. The last 20% is where the calendar
  goes.
- **Data migration and go-live** for each school onboarded.

**So the honest shape:**

| | Build | Realistic calendar, with prompt review |
| --- | --- | --- |
| Exams + result cards | ~2 sessions | 1–2 weeks |
| Print documents (each) | ~1 session for several | days |
| POS | ~1–2 sessions | 1–2 weeks |
| Internal chat (through push) | ~4–6 sessions | 3–5 weeks |
| Student promotion | <1 session | days |
| Excel import | ~1 session | 1 week |
| Digital payments | ~2 sessions | 2–4 weeks — **gated on JazzCash/Easypaisa merchant approval, which is paperwork and their timeline, not ours** |

Two things that genuinely constrain the calendar regardless of how fast code
gets written:

1. **Payment gateway onboarding.** Merchant accounts with JazzCash and Easypaisa
   take weeks of paperwork. Start that process now if payments matter — it will
   otherwise be the thing everything waits on.
2. **A pilot school.** Everything above is guesswork until one real school uses
   it. One friendly school, onboarded early, is worth more than three more
   modules.

**The bottleneck has moved from typing to deciding.** Plan your time around
answering questions and testing, not around waiting for code.

---

## 7. What this does not cover

The competitor's site does not mention library, transport, hostel or inventory
management. Those are common in school ERPs and may well appear in the video or
in competing products. Not assumed here, because there was no evidence for
them — worth checking before planning a second phase.
