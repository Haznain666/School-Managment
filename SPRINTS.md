# SPRINTS.md — the delivery plan

**Written:** 2026-08-08
**Supersedes:** `remaining work.docx` (the sprint document), which was written when
`main` was at Sprint 6 and against a stack this project no longer runs.
**Reads alongside:** `STATE.md` (where the code actually is) and `ROADMAP.md`
(what the market needs and why).

This file is the **plan**. `STATE.md` is the **truth**. When they disagree,
`STATE.md` wins and this file gets corrected.

---

## 0. Reconciling the sprint document with reality

The document is a good plan for a different codebase. Six of its premises are
now false, and every one of them changes what gets built.

### 0.1 Stack corrections

| The document says | Reality since 2026-08-07/08 | Consequence |
| --- | --- | --- |
| Firebase Auth | **Supabase Auth (GoTrue)** | Sprint 18's "restore `lib/otp.ts` WhatsApp path" targets deleted code |
| Neon PostgreSQL | **Supabase Postgres** via Supavisor pooler | `db.batch()` no longer exists; use `batch(db, (tx) => …)` |
| Vercel | **Hostinger**, `output: 'standalone'` | I-3 (Vercel env vars) is moot; no 60s serverless limit, but also no CDN or cron |
| GHL as CRM backend | **GHL is opt-in per school** (`schools.ghl_location_id`, nullable) | Sprint 11 cannot be built on GHL; Sprint 10's "publish → GHL bulk email" cannot be the delivery path |
| WhatsApp commented out with `/* WHATSAPP_DISABLED_START */` markers | **Gated behind the `whatsapp` flag in `school_modules`**, default off | Sprint 18 is ~70% already done, and differently |
| `recharts` "already in stack" | **Not a dependency.** Deps are: `@supabase/*`, `bcryptjs`, `clsx`, `drizzle-orm`, `jose`, `next`, `node-vibrant`, `nodemailer`, `postgres`, `react*`, `server-only`, `sharp`, `tailwind-merge` | Sprint 12 must budget for the charting choice, not assume it |

Also dead in the "Critical Technical Reminders" block: `db.batch()`, the Neon
HTTP driver, Firebase, and the WhatsApp comment markers. Everything else in
that block is still correct and still binding.

### 0.2 Sprint 7 is already built

`db/migrations/0009_sprint7_hr_payroll.sql` and
`0010_sprint8_roles_permissions.sql` are on `main`. What the document scheduled
as one Sprint 7 became two shipped sprints.

| Document item | Status |
| --- | --- |
| Sprint 7 — HR & Payroll (14 tables) | ✅ Shipped — `db/schema/hr.ts`, `staff*.ts`, `payroll-runs.ts`, `payslips*.ts`, `leave-*.ts`, `/dashboard/hr`, `/dashboard/payroll` |
| BR1 — School branding | ✅ Shipped — `school_branding` table, `lib/branding.ts`, used by `PrintLetterhead` |
| BR2 — Logo upload bug | ✅ Resolved by the storage migration; `next.config.mjs` `remotePatterns` now derives from `SUPABASE_URL` |
| BR3a — `school_administrator` role | ❌ Not built — **and I recommend rejecting it**, see §0.3 |
| BR3b — `hr_manager` role | ✅ Shipped — one of 11 roles in `USER_ROLES` |
| BR4 — Multiple principals per school | ❌ Not built — **keep it**, scheduled in Sprint 13 |
| BR5 — Dynamic permission management | ✅ Shipped, and better than specified — see §0.3 |

### 0.3 Two design calls I am making against the document

**Reject BR3a (`school_administrator` role).** Its entire definition is "read
HR/payroll/admissions/fees, write announcements and events". That is a
*permission set*, not a role, and BR5 shipped precisely so a school can express
it without a code change. Adding a twelfth role hard-codes one school's org
chart into the CHECK constraint on three tables. Use `coordinator` or
`vice_principal` and grant the permissions.

**BR5 shipped as overrides, not as a full grant table, and that was right.**
The document specified `rolePermissions` holding every grant. The built design
(`db/schema/role-permissions.ts` + `DEFAULT_ROLE_PERMISSIONS` in
`lib/permissions.ts`, 40+ keys) stores only a school's *departures* from the
default. The difference matters: with a full grant table, a permission added by
a future sprint arrives granted to nobody at every existing school, silently.
With overrides it arrives with a sensible default everywhere. **Every sprint
below that adds a module must add its permission keys to `PERMISSIONS` and
`DEFAULT_ROLE_PERMISSIONS`** — that is now part of the definition of done.

### 0.4 The sequencing error that matters most

The document schedules **exams in Sprint 14**. But:

- Sprint 12 promises an "Academic Results Report".
- Sprint 13 promises a parent-facing "Report card view".
- Sprint 15 promises student "Results history … trend chart".

None of those can exist before exams do. `ROADMAP.md` §2 independently reaches
the same conclusion from the market side — exams is Tier 1, item 1, *"a school's
academic year is organised around exams. Everything in Tier 1 below depends on
this existing."* There is no `exams`, `exam_results` or `grading_schemes` table
in the repo today.

**Exams moves to first.**

### 0.5 What the document omits entirely

From `ROADMAP.md`, absent from the sprint document and all of it in scope:

| Missing | Why it cannot wait |
| --- | --- |
| **Excel/CSV bulk student import** | The document has it in Sprint 19. It is how a school gets its 800 students in on day one. Without it there is no pilot. |
| **Promote students to next class** | `ROADMAP.md` calls it *"biggest omission on this list"*. Every school does it once a year for every student. |
| **Internal chat** (`ROADMAP.md` §5) | The decided replacement for WhatsApp. The document still assumes WhatsApp comes back. |
| **Web Push / PWA** | Without it, chat replaces a channel parents read with one they do not open. This is a fee-collection risk, not a UX nicety. |
| **Parent wallet + POS/merchandise** | Confirmed in scope 2026-08-07. Has a blocking question that cannot be retrofitted (§4). |
| **Family / sibling fee grouping** | Directly advertised by the competitor as "Parent Voucher". Cheap; `student_guardians` already carries the grouping key. |
| **Fee defaulter list** | *"The report an accountant actually opens each morning."* |
| **JazzCash / Easypaisa** | The document says Stripe. See §0.6. |
| **Subject-wise attendance** | Ours is per-day; the competitor's is per-lecture. Needed for secondary schools. |

### 0.6 Payments: the document conflates two unrelated systems

- **Parents paying the school** — fee challans and merchandise. Pakistani
  market: **JazzCash and Easypaisa**, cards later. Stripe does not serve this.
- **Schools paying us** — SaaS subscription (document Sprint 16). Stripe is
  plausible *here*, but a Pakistani entity billing Pakistani schools in PKR will
  more likely need a local rail too.

These are separate sprints with separate gateways. **Merchant onboarding for
JazzCash/Easypaisa is weeks of their paperwork on their timeline** and is the
single longest-lead item in this entire plan. It is question 2 in §7.

### 0.7 The go-live date

The document targets **September 5–7, 2026**. Today is 2026-08-08 — 28 days.
Its own timeline table sums to roughly 83 working days plus a 21-day beta.

Code generation compresses the build (see `ROADMAP.md` §6 — the print framework
was estimated at 8–12 days and took about an hour). It does not compress your
review, testing against a real school, or a beta. **Full scope by September 7 is
not achievable, and planning as if it were is how the pilot gets a half-built
system.**

What *is* achievable: **Release 1 below — one pilot school running for real on
exams, fees, attendance, HR and reports.** That is a credible early-September
milestone and it is worth more than three more modules. This is question 1 in §7.

---

## 0.8 Decisions taken 2026-08-08

The four questions in §7 are answered. Three of them change the plan.

**1. Scope is cut to Release 1 for September 7.** Sprints 0 and 9–13. R2 and R3
follow after, unscheduled until R1 has actually run. See §1.1 for the calendar.

**2. JazzCash / Easypaisa merchant onboarding has NOT started.** It is now the
longest-lead item on the plan and nothing in this repo shortens it. It does not
block Release 1 — R1 has no online payment — but **every week it is not started
is a week added to whenever schools can take money through the platform.** Start
the applications this week regardless of what sprint is running.

**3. POS products have size and colour variants.** This settles the largest
structural question in `ROADMAP.md` §7. Sprint 20's stock tables are
**variant-first from the first migration** — a `products` / `product_variants`
split where stock, price and barcode live on the variant, never on the product.
Do not build flat products "for now": retrofitting variants means rebuilding the
stock tables and migrating live stock counts, which is exactly the cost this
decision was made to avoid.

**4. The pilot is a seeded test school, not a real one.** This is a legitimate
choice and it changes what Release 1 can claim.

A test school proves the *software*. It does not prove the *operation*, and
three specific risks stay open until a real school runs a term:

- **Printed artefacts at the counter.** A fee voucher that looks right on screen
  and is rejected at a bank counter is not finished. Nobody on this project can
  discover that from seeded data.
- **Parent reach.** Whether parents open the portal at all is the premise the
  whole chat-replaces-WhatsApp decision rests on (`ROADMAP.md` §5). A test
  school has no real parents, so Sprint 15's central risk stays unmeasured.
- **Data migration.** Real school data is messier than anything we will seed —
  duplicate students, missing guardians, mid-year joiners, fee arrears carried
  from a previous system. Sprint 10's importer will be tested against clean data
  and meet dirty data later.

**Therefore the R1 exit gate is redefined** (§1) from "a pilot school runs a full
term" to a **full-term dress rehearsal on seeded data**, and **finding a real
pilot school stays the highest-value open item on the project.** It has simply
stopped being a blocker for shipping R1.

To make the rehearsal worth something, the seed must be adversarial rather than
tidy: ~400 students across 3 grades and 2 branches, siblings sharing guardians,
a handful with no email address, mid-term joiners, partial fee payments,
concessions, and at least one student transferred between branches. Seeding this
is part of Sprint 10.

---

## 1. Release structure

| Release | Sprints | Theme | Gate |
| --- | --- | --- | --- |
| **R0** | Sprint 0 | Reconciliation & auth hardening | Stale branches gone, rate limiting live |
| **R1 — Pilot Ready** | 9–13 | What one real school cannot operate without | **Full-term dress rehearsal on seeded data** — see §0.8 |
| **R2 — Commercial Parity** | 14–19 | What makes it sellable against OurSchoolSoftware | Feature parity demo-able |
| **R3 — Scale & Monetise** | 20–25 | Revenue, commerce, hardening, launch | Public launch |

**Committed: R1 ships by 2026-09-07.** R2 and R3 are sequenced but not dated —
dating them before R1 has run would be the same mistake the source document made.

### 1.1 The Release 1 calendar

28 days, 2026-08-08 → 2026-09-07. Durations are **calendar days including your
review**, not build time. `ROADMAP.md` §6 is right that the bottleneck has moved
from typing to deciding — every row below is dominated by your review, not by
code generation.

| Dates | Sprint | Notes |
| --- | --- | --- |
| Aug 8–10 | **0** — Reconciliation & auth hardening | Rate limiting, lockout, email outbox, branch pruning |
| Aug 11–16 | **9** — Exams, results & report cards | The keystone and the largest. Everything after depends on it. |
| Aug 17–21 | **10** — Import, promotion, transfer, family fees | Includes seeding the adversarial test school (§0.8) |
| Aug 22–25 | **11** — Communications | Needs Sprint 0's outbox |
| Aug 26–29 | **12** — Reports & analytics | Needs Sprint 9 |
| Aug 30–Sep 3 | **13** — Portals + PWA shell + BR4 | Needs Sprint 9 |
| Sep 4–7 | **Dress rehearsal** | Full term simulated end to end on seeded data, every role, every printed document |

**Where this slips first:** Sprint 9. It is the largest, it is first, and
everything downstream waits on it. If it runs long, Sprint 12 (reports) is the
one to compress — reports are additive and can ship thin. **Do not compress
Sprint 10**; without import and promotion there is no school to demonstrate.

**Numbering continues from the repo, not the document.** The repo has consumed
Sprints 1–8. Sprint numbers below are the repo's. Each row names the document
sprint it derives from so the two can be cross-read.

**Migrations continue at `0015`.** `0000`–`0014` are applied and recorded
against the live Supabase database. The document's migration table (0011 = Email
Auth, 0012 = HR, …) is off by three and must not be used.

---

## 2. The sprints

### Sprint 0 — Reconciliation & auth hardening
*Derives from: document §Immediate Tasks I-1…I-8. Migration: none.*

Small, and it clears debt that would otherwise be re-discovered every sprint.

| Document task | Disposition |
| --- | --- |
| I-1 Merge email-auth PR | **Cancelled.** Rebuilt on Supabase Auth; `STATE.md` §5d explains why. Branch stays unmerged as a parts bin. |
| I-2 Supabase bucket public | **Keep** — still unverified |
| I-3 Remove Firebase env vars from Vercel | **Moot** — no Vercel, no Firebase |
| I-4 `/api/super-admin/diagnostics/storage` → `ok: true` | **Keep** |
| I-5 Backfill `__drizzle_migrations` 0009/0010 | **Done** — database was rebuilt with full bookkeeping |
| I-6 Delete stale branches | **Keep** — 4 merged branches + 4 worktrees to prune |
| I-7 GHL OAuth Client ID | **Deferred to Sprint 22** — GHL is opt-in and there is no OAuth install flow in this repo yet |
| I-8 DMARC record | **Keep, blocked** on the domain decision (`STATE.md` §6.4) |

Plus, and these are the real content of the sprint:

- **Rate limiting on every auth endpoint.** Login, OTP request, forgot-password,
  setup-token redemption. There is no rate limiter in the codebase and the auth
  surface is now live. Document Sprint 20 assumes `@upstash/ratelimit`; on
  Hostinger with a single Node process, a Postgres-backed or in-process limiter
  is simpler and has no new vendor. **Decide deliberately.**
- **Account lockout** after 5 failed logins, 15 minutes.
- **Move outbound email off the request.** `STATE.md` §5k measured `sendMail` at
  ~103 seconds against `smtp.titan.email`. An operator watching a spinner for
  two minutes concludes the feature is broken, and no bulk campaign (Sprint 11)
  can run inside a request at all. Needs an `email_outbox` table and a drain —
  this is infrastructure three later sprints depend on, so it lands here.
- Fix the `STATE.md` header staleness and the §5b "not started" heading.

---

## Release 1 — Pilot Ready

### Sprint 9 — Exams, results & report cards
*Derives from: document Sprint 14 (partial) + `ROADMAP.md` Tier 1 #1, #2 and §2b.
Migration: `0015_sprint9_exams.sql`.*

The keystone. Nothing else in R1 is worth much without it.

**Schema** — every table carries `location_id` and is indexed on it, per
`db/schema/attendance-records.ts`:

- `exam_terms` — name, academicYearId, startDate, endDate, isPublished
- `exams` — termId, gradeId, sectionId, title, examDate, createdBy
- `exam_subjects` — examId, subjectId, maxMarks, passingMarks, examDate, slot
- `exam_results` — examSubjectId, studentId, marksObtained, isAbsent, remarks, enteredBy
- `grading_schemes` + `grading_bands` — per school: band label, min %, max %, gpa

**Deliverables**
- Marks entry: teacher enters one subject for one section on one screen, with
  save-as-draft and a publish step the teacher cannot undo alone.
- Grading: bands → letter grade → GPA, configured per school, not hard-coded.
- **Report card** on the existing `PrintSheet` framework — subject marks,
  totals, position in class, grade, attendance summary, remarks.
- **Tabulation sheet** and **position holders** (`ROADMAP.md` §2b) — the
  class-wide grid a principal reviews after exams.
- **Admit card** per student per exam.
- Re-sit handling.
- Permission keys: `exams.read`, `exams.write`, `exams.publish`, `results.enter`,
  `results.publish`.

**Why the print artefacts ship in the same sprint:** `ROADMAP.md` §2 Tier 1 #2 —
*"this is the artefact parents judge the entire system by"*. A results module
with no report card is not a results module.

**Watch:** the 200-row print cap and its `lib/challan-print.ts` reasoning applies
to tabulation sheets too.

---

### Sprint 10 — School onboarding: import, promotion, transfer, family fees
*Derives from: `ROADMAP.md` §2b (absent from the document) + document Sprint 17
and Sprint 19's CSV import, both pulled forward.
Migration: `0016_sprint10_onboarding.sql`.*

**This sprint is what makes a pilot possible at all.** Nothing here is a
differentiator; all of it is the difference between "we have a system" and "a
school can start using it on Monday."

- **Excel/CSV bulk student import.** Upload → column mapping → **dry-run
  validation report** → commit. Must be idempotent and must report per-row
  failures rather than aborting the batch. The document put this in Sprint 19,
  which is nine sprints after the pilot needs it.
- **Promote students to next class.** Academic-year rollover: select grade →
  preview roster → promote, retain, or graduate per student. Writes new
  `student_enrollments` rows; never mutates history.
- **Campus / branch transfer** (`student_transfers`) with fee proration at the
  transfer date and section/timetable reassignment.
- **Family / sibling fee grouping.** One voucher, one total, for a parent with
  three children. `student_guardians` already carries the key.
- **Fee defaulter list** with aging buckets.
- Permission keys: `students.import`, `students.promote`, `students.transfer`.
- **Seed the adversarial test school** (§0.8). ~400 students, 3 grades,
  2 branches, siblings sharing guardians, some with no email address, mid-term
  joiners, partial payments, concessions, one cross-branch transfer. This is the
  data every later sprint demonstrates against, and a tidy seed would hide
  exactly the defects the rehearsal exists to find. Ship it as a script under
  `db/seed/`, never as hand-entered rows.

**Risk to hold:** promotion and import both write large batches. Use
`batch(db, (tx) => …)` and build statements on `tx` — `lib/drizzle.ts` explains
why a builder made from `db` escapes the transaction.

---

### Sprint 11 — Communications: announcements, notice board, campaigns
*Derives from: document Sprint 11, rebuilt off GoHighLevel.
Migration: `0017_sprint11_comms.sql`.*

The document builds this entirely on GHL Conversations. GHL is now opt-in, so
**the default delivery path must be ours**, with GHL as enrichment when a school
has connected it and WhatsApp when `school_modules.whatsapp` is on.

- `announcements` — title, body, targetAudience (jsonb: all | grade | section |
  role), branchId, scheduledAt, sentAt
- Notice board on all four portals + unread badge
- Bulk email campaigns over the Sprint 0 outbox, with the school's branding
  header from `lib/branding.ts`
- Delivery log per recipient: queued / sent / failed / unreachable — reusing
  `canReachGuardian()` so the report and the sender cannot disagree
- GHL Social Planner: **deferred to Sprint 22**. It is a GHL-only feature and
  belongs with the other integration work, not on the critical path.

---

### Sprint 12 — Reports & analytics
*Derives from: document Sprint 12, now unblocked by Sprint 9. Migration: none.*

All nine report types from the document: attendance summary, subject-wise
attendance, fee collection, outstanding/aging, academic results, payroll
summary, leave summary, enrollment funnel, monthly revenue.

**Two corrections to the document's technical notes:**
- **No `@react-pdf/renderer` or `jspdf`.** `ROADMAP.md` §2 Tier 1 #3 settled
  this: the browser's print dialog is the renderer, because Hostinger runs a
  plain Node process where headless Chromium is unreliable. Reports print
  through `PrintSheet` with the school letterhead.
- **`recharts` is not installed.** Adding it is a real decision (bundle size
  against the <200 kB first-load target in document Sprint 21). Server-rendered
  SVG for the three or four charts that matter is the cheaper answer — decide
  it in this sprint rather than assuming.

CSV export stays as specified: native `Response` with `text/csv`.

---

### Sprint 13 — Portal completion + PWA shell + multiple principals
*Derives from: document Sprints 13, 14, 15 merged, plus BR4.
Migration: `0018_sprint13_portals.sql`.*

The document splits parent, teacher and student polish into three sprints. They
are one UX pass over three thin portals sharing the same data; splitting them
triples the review overhead for no benefit.

- **Parent** — multi-child selector, attendance calendar, report card view
  (Sprint 9), challan download, notification preferences
- **Teacher** — gradebook wired to Sprint 9 exams, mobile attendance quick-mark,
  class roster, lesson plans (`lesson_plans`), own payslips and leave
- **Student** — timetable grid, assignment tracker, exam schedule, results
  history, own challans
- **BR4 — multiple principals.** `schools.principal_model` (`single` | `multiple`),
  `principal_assignments` (schoolId, branchId, divisionName, userId, dates),
  `lib/principal-resolver.ts`. Real for Pakistani schools running O-Levels and
  Matric under separate heads. **Do not implement the document's dynamic
  `principal_${divisionSlug}` role** — that puts unbounded values into a CHECK
  constraint and defeats BR5. The role stays `principal`; the *assignment*
  scopes what they see.
- **PWA shell** — manifest, service worker, installability, offline app shell.
  No push yet; this is the substrate Sprint 15 needs, and shipping it here means
  parents are already installing the app before push arrives.

**🚩 Release 1 gate — onboard the pilot school and run a full term.**

---

## Release 2 — Commercial Parity

### Sprint 14 — Internal chat, part 1
*Derives from: `ROADMAP.md` §5 build order 1–3. Absent from the document.
Migration: `0019_sprint14_chat.sql`.*

Tables per `ROADMAP.md` §5: `chat_conversations`, `chat_participants`,
`chat_messages`, `chat_settings`, `chat_reports`.

1. Data model + **RLS policies** + the permission resolver. RLS is the point:
   a conversation you are not a participant in is refused by the database, not
   hidden by the UI.
2. Direct messages, text only, staff ↔ staff — proves the Supabase Realtime layer.
3. Parent and student rules + the per-teacher `students_may_initiate` opt-in
   (default off). "Teachers of their children" derives from
   `student_guardians` → `student_enrollments` → `sections` → `timetable_entries`.

### Sprint 15 — Chat part 2 + Web Push
*Derives from: `ROADMAP.md` §5 build order 4–7. Migration: `0020_sprint15_push.sql`.*

Groups, one-way announcement channels, attachments, voice notes
(`MediaRecorder` → Supabase Storage), then **Web Push via VAPID**, quiet hours,
reporting, moderation and retention.

**This sprint decides whether replacing WhatsApp was correct.** `ROADMAP.md`
§5 is blunt: without push, this replaces a channel parents read with one they do
not open, and fee collection suffers. Two things to carry into onboarding:
- **iOS gives no notifications until the parent adds the site to their home
  screen**, and nothing prompts them. Onboarding must walk them through it.
- Email digest fallback for anyone without push.

### Sprint 16 — Digital payments: JazzCash / Easypaisa + parent wallet
*Derives from: `ROADMAP.md` Tier 2 #4 and §2b. Migration: `0021_sprint16_payments.sql`.*

- Gateway abstraction, JazzCash and Easypaisa adapters, webhook receipt with
  signature verification, reconciliation against `fee_challans`
- **Parent wallet, per family not per student** — append-only ledger, balance
  derived and never edited directly. Build the ledger before POS: fees, POS and
  refunds all sit on it.
- `fee_payments` already stores `payment_method` and `reference_number`, so the
  data model mostly accommodates this.

**⚠️ Hard external dependency.** Merchant onboarding is weeks of paperwork on
their timeline. If it has not started, this sprint slips regardless of code.
Three questions in `ROADMAP.md` §7 must be answered first — can the wallet go
negative, where do refunds land, does an unused balance follow a leaver.

### Sprint 17 — LMS part 1: courses & content
*Derives from: document Sprint 8, unchanged in substance. Migration: `0022_sprint17_lms.sql`.*

`lms_courses`, `lms_sections`, `lms_lessons`, `lms_assignments`, `lms_quizzes`,
`lms_questions`, `lms_enrollments`. Course builder with ordering, video/document/
text/quiz lesson types, bulk enrolment by grade or section.

### Sprint 18 — LMS part 2: student experience
*Derives from: document Sprint 9. Migration: `0023_sprint18_lms_submissions.sql`.*

`lms_submissions`, `lms_quiz_attempts`, `lms_progress`. Course player, progress
tracking, assignment upload, timed quiz player, certificate on completion.

**Correction:** the document says certificates are "PDF certificate … Supabase
Storage". Use `PrintSheet` for the same reason as §Sprint 12 — no headless
renderer on Hostinger.

### Sprint 19 — Events & calendar
*Derives from: document Sprint 10. Migration: `0024_sprint19_events.sql`.*

`events`, `event_attendees`, `event_reminders`. Calendar view, RSVP, attendance
marking, post-event gallery.

**Correction:** the document routes publish notifications through "GHL bulk
email". Route them through the Sprint 11 announcement path — our SMTP by
default, chat announcement channel, GHL only if connected.

**🚩 Release 2 gate — feature parity with OurSchoolSoftware, demo-able.**

---

## Release 3 — Scale & Monetise

### Sprint 20 — POS, inventory & merchandise checkout
*Derives from: `ROADMAP.md` §2b. Absent from the document. Migration: `0025_sprint20_pos.sql`.*

Products, stock, over-the-counter sale, barcode scan, low-stock alerts,
purchase-vs-sale reporting — **and** a parent-facing cart and checkout sharing
the Sprint 16 wallet and gateway.

**Variants are decided (2026-08-08): yes.** `products` holds the sellable thing
(name, category, tax); `product_variants` holds size, colour, **stock count,
price and barcode**. Nothing sells directly from `products`; a product with one
variant is the degenerate case, not a special case. Stock movements reference
the variant, never the product.

Build it this way from the first migration. Flat products "for now" would mean
rebuilding the stock tables and migrating live counts later, which is the exact
cost this decision avoids.

**Still open before this sprint** (`ROADMAP.md` §7): can staff sell over the
counter *and* parents buy online from the same stock — if so, stock needs
locking to prevent overselling the last shirt; and is merchandise ever billed to
the fee challan instead of paid at checkout.

### Sprint 21 — SaaS billing & subscriptions
*Derives from: document Sprint 16. Migration: `0026_sprint21_saas.sql`.*

`saas_plans`, `saas_subscriptions`, `saas_invoices`, `saas_usage`. Plans as
specified (Starter PKR 15,000 / Growth 35,000 / Enterprise 75,000). Feature
gating via `hasFeature(schoolId, …)`, which should read `school_modules` rather
than introduce a second source of truth.

**Correction:** usage tracking is specified as a daily cron. Hostinger is a
plain Node process — there is no platform cron. Either a host-level cron hitting
a protected route, or an on-read counter. Decide it here.

### Sprint 22 — Integrations, webhooks & public API
*Derives from: document Sprint 19, plus deferred items I-7 and the Social Planner.*

GHL OAuth install flow (a working one exists on the abandoned
`claude/school-email-auth-7f5vuh` branch and is worth lifting), GHL webhook
receiver with signature verification, outbound webhooks per school, API-key auth
for third-party tools, GHL Social Planner, and the REST surface a future mobile
app needs.

### Sprint 23 — Security audit & hardening
*Derives from: document Sprint 20, minus what Sprint 0 already did.*

Full permission audit of every route against `withSchoolAuth` and the BR5 keys;
CSRF on the GHL OAuth callback; `assertSafePath()` verification on every storage
path; secrets audit for `NEXT_PUBLIC_` leakage; cookie flags; `npm audit`; OWASP
Top 10. **Plus two open items from `STATE.md`:** refresh-token revocation on
deactivation (§5k — `revokeAllSessions` is currently a documented no-op), and a
deliberate decision on `outputFileTracingRoot` before the first real deploy.

### Sprint 24 — Performance
*Derives from: document Sprint 21.*

`EXPLAIN ANALYZE` on the top 20 queries; indexes on `location_id + status`,
`studentId + academicYearId`, `createdAt`; N+1 elimination in attendance and
results reports; bundle analysis against <200 kB first load; Supabase Storage
CDN. **Correction:** "Neon connection pooling / PgBouncer for Vercel serverless"
is moot — tune the Supavisor pooler and the `postgres-js` pool size instead.

### Sprint 25 — Beta, pre-launch hardening & launch
*Derives from: document Sprints 22–25, collapsed.*

Error monitoring, uptime monitoring on `/api/health`, feedback form, feature
flags per school, beta onboarding guide, mobile responsiveness audit, print
quality audit on A4, Urdu/bilingual assessment, backup and DR plan, Privacy
Policy and ToS, PDPA review, load testing, DNS cutover, on-call rotation.

**Kept from the document verbatim because it is right:** a pre-created
`hotfix/launch` branch and a 48-hour on-call rotation for launch weekend.

---

## 3. The agent model

Each sprint runs as a three-agent chain. Definitions live in `.claude/agents/`
and are invocable by name.

```
  ┌─────────────┐   green build   ┌──────────┐   verdict   ┌───────────────┐
  │  sprint-    │ ──────────────▶ │ sprint-  │ ──────────▶ │   sprint-     │
  │  developer  │ ◀────────────── │   qa     │             │   devops      │
  └─────────────┘   findings      └──────────┘             └───────────────┘
        │                                                          │
        └── isolated worktree, feature/sprint-N-<slug>              └── report to you
```

### 3.1 `sprint-developer`
**Isolation:** its own git worktree, branch `feature/sprint-N-<slug>` off `main`.
**Must follow** the binding conventions in §5. **Must produce:**
- The migration file, numbered next in sequence, never renumbering an existing one
- New permission keys added to `PERMISSIONS` **and** `DEFAULT_ROLE_PERMISSIONS`
- `npm run typecheck` · `npm run lint` · `npm run build` — all three green
- A `STATE.md` section for the sprint, in the existing voice

**Must not:** run `db:migrate` against the live database (that is DevOps), run
`next build` while a dev server is running (`STATE.md` §5f), or rewrite source
files with PowerShell `Get-Content`/`Set-Content` (`STATE.md` §7 note).

### 3.2 `sprint-qa`
Read and browser tools only — **no edit access, deliberately.** An agent that
can fix what it finds stops looking.

**Verifies, in this order:**
1. Every acceptance criterion in the sprint spec, driven through the in-app browser
2. **Tenancy isolation** — a cross-tenant probe on every new route. `location_id`
   never from user input.
3. **The permission matrix** — every new route exercised as each role that
   should and should not reach it
4. Print output at A4 where the sprint ships a document
5. Console and network errors, not just happy-path rendering

**Reports findings; does not fix them.** Findings go back to `sprint-developer`
for a second pass. `STATE.md` §5j is the evidence this step earns its keep — the
first browser pass found six defects that typecheck, lint and build all passed.

**Known constraint:** the in-app browser has its own cookie jar and I do not type
passwords. Someone signs it in once per session; everything after that is
drivable (`STATE.md` §5i).

### 3.3 `sprint-devops`
**Applies migrations** against the Supabase **session pooler on port 5432** (not
6543 — `STATE.md` §5d has the exact command and why `npm run db:migrate` alone
does not work). Verifies each migration's effects against the live schema rather
than trusting the exit code.

**Builds the artifact** on a clean tree, after deleting
`.claude/worktrees/node_modules` if a previous worktree build created it
(`STATE.md` §5f — the first build after deleting passes, the second fails).

**Diffs env vars** against `.env.example` and reports what Hostinger is missing.

**What it cannot do, and will say so rather than pretend:** push to Hostinger.
There are no host credentials in this environment, `gh` is not on PATH, and
`sharp` ships platform-specific binaries so the artifact must be built on
Linux/Node 20+, not Windows. Its output is a verified migration state plus a
deploy checklist for you or for CI.

### 3.4 Reporting
At the end of each chain you get: what shipped, what QA found and whether it was
fixed, migration state against the live database, the three quality gates, and
what is now blocked on you. `STATE.md` is updated in the same commit.

### 3.5 When to run fewer than three
Sprint 0 and Sprint 12 have no migrations — DevOps runs a build check only.
A sprint with no UI (none below, but they occur) skips the browser half of QA.
The chain is a default, not a ritual.

---

## 4. Critical path

Three items gate more than they appear to, and two are outside this repo.

1. **🔴 JazzCash / Easypaisa merchant onboarding — NOT STARTED as of 2026-08-08.**
   Weeks of their paperwork on their timeline. Gates Sprint 16, and Sprint 20
   through the shared checkout. It does not block Release 1, which has no online
   payment — but it is now the item that decides when schools can take money
   through the platform at all. **Start the applications this week.** No code
   shortens it and no sprint ordering avoids it.
2. **🔴 The domain name** — still unanswered. Fills `PLATFORM_BASE_DOMAIN`,
   `NEXT_PUBLIC_APP_DOMAIN`, `INVITE_LINK_BASE_URL`, `GHL_REDIRECT_URI`, and the
   DMARC record (I-8). **Gates any deploy at all**, including the Sep 4–7 dress
   rehearsal if that is to run anywhere but localhost. Needed before Sprint 13.
3. **🟡 A real pilot school** — no longer blocks R1 (§0.8 settles the rehearsal
   on seeded data), but it remains the highest-value open item on the project.
   Printed artefacts at a bank counter, parent app adoption, and dirty data
   migration cannot be proven without one. Every week without one is a week of
   R2 priorities set by guesswork.

Inside the repo, the ordering constraints that cannot be reordered:

```
Sprint 9 (exams) ──▶ Sprint 12 (results reports)
                 ──▶ Sprint 13 (report card, gradebook, results history)

Sprint 0 (outbox) ──▶ Sprint 11 (campaigns) ──▶ Sprint 19 (event notifications)

Sprint 13 (PWA shell) ──▶ Sprint 15 (Web Push) ──▶ chat is safe to rely on

Sprint 16 (wallet ledger) ──▶ Sprint 20 (POS checkout)

Sprint 10 (import) ──▶ pilot onboarding ──▶ everything real
```

---

## 5. Binding conventions

Carried forward from the document's "Critical Technical Reminders", **corrected**
for the current stack. Every agent follows these; a deviation is a review defect.

| | |
| --- | --- |
| Auth | `withSchoolAuth(handler, { allowedRoles })` |
| Guard | `requireSchoolRole(roles)` from `lib/school-guard.ts` |
| Permissions | `hasPermission(auth, key)` — add new keys to `PERMISSIONS` **and** `DEFAULT_ROLE_PERMISSIONS` |
| Response | `apiSuccess()` / `apiFailure()` / `handleApiError()` |
| Body parsing | `readJsonBody<T>()` — **no Zod** |
| Trusted tenant | `auth.locationId` **only** — never from body or query |
| Updates | `PATCH`, not `PUT` |
| Money | `NUMERIC` in the database, integer **paise** in JS |
| Primary keys | `uuid` `defaultRandom()` |
| Enums | `text` + `CHECK` constraint — **not** `pgEnum` |
| Transactions | **`batch(db, (tx) => […])`** from `lib/drizzle.ts`. Statements must be built on `tx`. `db.batch()` was a Neon API and no longer exists. |
| Storage | `buildStoragePath` + `uploadBuffer` + `deleteObject` from `lib/storage.ts` |
| Tenancy | every new table carries `location_id` and is indexed on it |
| Printing | `PrintSheet` — no PDF library, no headless Chromium |
| Sessions | Supabase Auth; authorization read per request from `school_users` via `membershipFor()`, never from the token |
| WhatsApp | gated behind `school_modules.whatsapp` via `isWhatsAppEnabled()` — **not** commented out |
| GHL | opt-in per school; every GHL call goes through `ghlLocationFor()` |

---

## 6. What I have deliberately not planned

- **Biometric / device attendance** (`ROADMAP.md` Tier 3 #8) — hardware
  integration and on-premise connectivity. Real demand, but do not commit to it
  before a paying school asks.
- **Native mobile apps** (Tier 3 #9, ~30–45 days + a paid Apple Developer
  account) — `ROADMAP.md` §5 recommends PWA first, native second, and I agree.
  Revisit after Sprint 15 proves parents use chat at all.
- **Bundled school website** (Tier 3 #10) — a sales feature, not a product one.
- **Full accounting** (Tier 2 #7, ~15–20 days) — schedule it when a school says
  it keeps separate books. Guessing this far ahead is how modules get built and
  never used.
- **Library, transport, hostel** — `ROADMAP.md` §8: no evidence the competitor
  has them. Check before planning a second phase.

---

## 7. Questions

### Answered 2026-08-08 — see §0.8

| | Answer |
| --- | --- |
| Go-live: cut scope or move the date? | **Cut to Release 1, ship Sep 7** |
| Merchant onboarding started? | **No** — now the critical path (§4.1) |
| Do uniforms have size/colour variants? | **Yes** — Sprint 20 is variant-first |
| Which school is the pilot? | **A seeded test school**; a real one stays open |

### Still open, each blocking its own sprint

**Before Sprint 13** (and any deploy at all):
- **The domain name.** Four env vars and the DMARC record depend on it.

**Before Sprint 15** (chat), from `ROADMAP.md` §7:
- Can a parent message the school office generally, or only their children's
  teachers? The agreed rules cover teachers but not the front desk.
- What happens to a conversation when a student leaves the school?

**Before Sprint 16** (payments/wallet), from `ROADMAP.md` §7:
- Can a wallet go negative — does the school extend credit — or is it strictly
  pre-paid? This changes the ledger design, so it must be settled before it is
  built, not after.
- Are refunds to the wallet, or back to the original payment method? Gateway
  refunds have fees and time limits; wallet credit does not.
- Does an unused balance follow a student who leaves? There is usually a local
  legal answer.
- Who absorbs the transaction fee — the school or the parent?

**Before Sprint 20** (POS):
- Can staff sell over the counter *and* parents buy online from the same stock?
  If so, stock needs locking to prevent overselling the last shirt.
- Is merchandise ever billed to the fee challan instead of paid at checkout?

**Ongoing, not blocking:**
- A real pilot school (§4.3).
