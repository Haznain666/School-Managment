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

### 0.7 There is no go-live date — deleted 2026-08-12

**This section used to carry a September 2026 target and a day-by-day calendar.
Both are gone, at the user's instruction: those dates were auto-generated by a
planning tool and were never a commitment anybody made.**

Do not reintroduce a date, and do not infer one from the sprint ordering. The
releases below are a **sequence**, not a schedule — R1 before R2 before R3,
because each depends on the last, and that is the only timing claim this
document makes.

If a date is ever needed (a pilot school's term start, an investor demo), it
comes from the user and gets recorded here explicitly as theirs. Anything else
is invented.

---

## 0.8 Decisions taken 2026-08-08

The four questions in §7 are answered. Three of them change the plan.

**1. Release 1 is the near-term scope.** Sprints 0 and 9–13. R2 and R3 follow
after. *(This originally read "cut to Release 1 for September 7"; the date is
deleted per §0.7. The scope decision stands — the deadline never existed.)*

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

## 0.9 Decisions taken 2026-08-12 — the competitor gap review

A full feature-by-feature comparison against the OurSchoolSoftware demo video
(transcript held by the user; findings folded into `ROADMAP.md` §2b). Ten
decisions came out of it. **Six are new modules**; the rest change existing
plans.

### The channel question is closed

**Chat + email carry everything. WhatsApp is the paid add-on. There is no SMS
gateway, ever.** The gap review found that almost every automatic alert the
competitor demonstrates is an SMS; the user's answer is that our equivalents
ride chat and email, with WhatsApp for schools that subscribe. This retires the
"should we add SMS" question permanently — do not re-open it, and do not model
a third channel.

The competitor's SMS-triggered events still have to exist, just on our
channels: absence alert, fee-received confirmation, defaulter reminder
sequences, exam-marks published, admission status. Those are Sprint 11 work
items, not a new gateway.

### Accounting is mandatory, and its position is settled

The user's instruction was "building accounting CRUD is your call when — but it
must be there." **It goes immediately after R1, as Sprint 13.5, before online
payments (16) and before POS (20).**

The reason is ordering, not enthusiasm: online payments, the parent wallet, POS
sales and refunds must all post to one **append-only ledger**, and retrofitting
a ledger underneath live money is precisely the cost the POS variants decision
(§0.8 #3) was made to avoid. Expenses are the cheap half and prove the ledger
before anything financial depends on it.

### Six new module flags

All six are `PLATFORM_MODULES` entries in `lib/platform-modules.ts`, switchable
per school in Super Admin > Modules, and all six are **paid features**:

| Flag | Sprint | Note |
| --- | --- | --- |
| `accounting` | 13.5 | Ledger, expenses, balance sheet, day-book |
| `online_classes` | new | Self-hosted Jitsi — see below |
| `biometric` | new | Device ingest — see below |
| `mobile_app` | new | Cross-platform app — see below |
| `e_learning` | 17 | Homework diary, study material *(was `lms`)* |
| `documents` | new | Certificates + ID card designer |

A school without `mobile_app` gets the web portal and the app says so at
sign-in, rather than half-working.

### Online classes — self-hosted Jitsi, and why the alternative fails

Per-participant-minute vendors (Daily, LiveKit, Agora, 100ms, ~$0.003–0.004/min)
cost **roughly $360–480 per school per month** at 30 students × 40 min ×
5 periods × 20 days = 120,000 participant-minutes. Subscription revenue is flat
per school; that bill is not. Self-hosted Jitsi is a flat ~$40–60/month VPS for
the *whole platform*.

Build: Jitsi Meet on a dedicated VPS, **JWT auth** so only signed-in users enter
a room, room names derived from `(location_id, class, date)`, videobridge
horizontally scalable by adding a JVB. Figures are approximate and worth
re-checking at purchase; the ratio is what decides, and the ratio is stable.

**Confirmed by the user 2026-08-12: self-hosted Jitsi, gated by the
`online_classes` module flag like everything else.** This is no longer an
assumption to revisit — the VPS is accepted as platform infrastructure, and a
per-minute vendor is not to be proposed again unless the cost picture changes.

### Biometric — build the architecture now, sell it per school

**Different readers do not share a codebase, but they mostly share a protocol
that makes cloud biometric possible.** The ZKTeco family — which includes eSSL,
Matrix and most local rebrands, and dominates this market — supports a push
protocol: the device is given a server URL and *it* POSTs logs outbound. No
local agent, no static IP at the school, no inbound firewall rule.

    device ──push──▶ /api/school/biometric/ingest ──▶ adapter ──▶ attendance_records

- `biometric_devices` — serial, school, branch, adapter key, shared secret, last-seen
- `biometric_events` — **raw payload, append-only**; attendance is *derived*, so a
  mis-mapped device is replayed rather than re-punched
- `lib/biometric/adapters/*` — one per protocol family, all implementing
  `parse(payload) → { deviceSerial, userRef, timestamp, direction }`
- `staff.biometric_user_id` / `students.biometric_user_id` for enrolment mapping

Ship the ZK push adapter first. Hikvision/Suprema (ISAPI, vendor SDKs needing a
Windows service) become a second adapter plus a small local bridge, added when a
school actually owns one — the ingest endpoint and schema do not change.

**Verify before building:** the exact model the first school owns, and whether
its firmware exposes the push/ADMS setting. Old firmware sometimes only polls.

This reverses §6's "do not commit to biometric". The architecture is committed;
the per-vendor adapters stay demand-driven.

### Gate attendance — the design, replacing the objection

1. **QR on the ID card, not a 1-D barcode.** Error correction; reads at an angle
   and off a scuffed card. A design decision on the ID card template that
   removes most failure modes for free.
2. **Native scanner in the app** (ML Kit / AVFoundation) — continuous scan,
   torch control. Not a web camera stream.
3. **Hardware scanners are first-class.** USB and Bluetooth gate scanners present
   as keyboards; a hidden focused input accepting scan-and-enter lets a school
   bolt a cheap scanner to the gate and skip phones. This is what a school with
   900 students at 07:45 will actually use.
4. **Offline-first by construction.** Each scan writes to a local append-only
   queue with a client-generated UUID, device id and monotonic timestamp; sync
   drains it when the network returns; the server dedupes on the UUID, and
   attendance is idempotent on `(student, date, session)` regardless.
5. **Gatekeeper role** — scan only. No roster, marks or fees.

### Cross-platform app — Capacitor, not React Native

Capacitor wrapping the existing Next.js PWA. One codebase, one UI, one auth
path, and it delivers the three things the web cannot: native camera (gate
scanning), **native push via FCM/APNs** — which sidesteps the iOS home-screen
problem in §Sprint 15 entirely — and reliable background storage for the offline
queue. React Native would mean maintaining a second implementation of every
screen for the same product.

Four role shells off one binary — parent, student, staff, gatekeeper — chosen at
login from the `school_users` row.

**External dependencies the user owns:** Apple Developer account ($99/yr) and
Google Play ($25 one-off). Apple review is the slow step; register early.

### Language — per-school, all languages, in Super Admin

A **language section against each school** in Super Admin, not an Urdu-only
toggle. The user wants the browser's built-in translation doing the heavy work.

The build is a hybrid, and the split matters:

- **The app shell is real i18n** — navigation, buttons, form labels, validation
  messages, and every print template. These must never be machine-translated,
  because browser translation cannot tell a label from data: it will happily
  translate a student's name, a school's name or a currency amount, and a
  garbled fee challan at a bank counter is a real failure.
- **Long-form and user-generated content is left to the browser.** Set
  `<html lang>` and `dir` from the school's setting so the browser offers to
  translate correctly, and so RTL layout switches for Urdu, Arabic and Pashto.

**RTL is the expensive half, not the translation**, and it gets more expensive
per screen added. Decide the i18n library and wrap the shell **before** R2 adds
more surface area.

### Everything else confirmed

- Payment gateway merchant onboarding **has begun** — this retires §0.8 #2 as
  the critical path, though it is still externally paced.
- Push notification reach is understood and accepted; stop flagging it as a risk.
- ID cards and certificates must work end to end — designer, preview, batch
  print, and print fidelity against a real card printer.

---

## 1. Release structure

| Release | Sprints | Theme | Gate |
| --- | --- | --- | --- |
| **R0** | Sprint 0 | Reconciliation & auth hardening | Stale branches gone, rate limiting live |
| **R1 — Pilot Ready** | 9–13, incl. **10.5** | What one real school cannot operate without | **Full-term dress rehearsal on seeded data** — see §0.8 |
| **R2 — Commercial Parity** | 13.5–19.7 | What makes it sellable against OurSchoolSoftware | Feature parity demo-able |
| **R3 — Scale & Monetise** | 20–25 | Revenue, commerce, hardening, launch | Public launch |

**No release is dated.** See §0.7 — the calendar that stood here was invented,
not agreed, and is deleted. The releases run in order because each depends on
the last.

### 1.1 Release 1 order of work

| Order | Sprint | Notes |
| --- | --- | --- |
| 1 | **0** — Reconciliation & auth hardening | ✅ Done |
| 2 | **9** — Exams, results & report cards | ✅ Done. The keystone; everything after depended on it. |
| 3 | **10** — Import, promotion, transfer, family fees | ✅ Done, including the adversarial seed (§0.8) |
| 4 | **10.5** — Design system, UI overhaul & dashboard charts | ⬅ **NEXT** (user, 2026-08-12). Run with `/impeccable`. Before 11–13, because each of those adds screens that would otherwise be designed twice. |
| 5 | **11** — Communications | Needs Sprint 0's outbox |
| 6 | **12** — Reports & analytics | Needs Sprint 9; charts come from 10.5 |
| 7 | **13** — Portals + PWA shell + BR4 | Needs Sprint 9 |
| 8 | **Dress rehearsal** | Full term simulated end to end on seeded data, every role, every printed document |

**If R1 has to be shortened**, Sprint 12 (reports) is the one to thin — reports
are additive. **Do not thin Sprint 10**; without import and promotion there is
no school to demonstrate.

**Numbering continues from the repo, not the document.** The repo has consumed
Sprints 1–8. Sprint numbers below are the repo's. Each row names the document
sprint it derives from so the two can be cross-read.

**Migrations continue at `0015`.** `0000`–`0014` are applied and recorded
against the live Supabase database. The document's migration table (0011 = Email
Auth, 0012 = HR, …) is off by three and must not be used.

**Corrected 2026-08-08:** this document said Sprint 0 needed no migration. It
does — rate limiting, lockout and the email outbox are all tables — so Sprint 0
takes `0015` and every migration named for Sprints 9 onward shifted up by one.
Sprint 9 is now `0016`. The numbers below are the corrected ones.

---

## 2. The sprints

### Sprint 0 — Reconciliation & auth hardening
*Derives from: document §Immediate Tasks I-1…I-8.
Migration: `0015_sprint0_auth_hardening.sql`.*

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
  is simpler and has no new vendor. **Decided: Postgres**, one `auth_attempts`
  table that is also the audit trail Sprint 23 will want. See `STATE.md` §5m.
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
Migration: `0016_sprint9_exams.sql`.*

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
Migration: `0017_sprint10_onboarding.sql`.*

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

### Sprint 10.5 — Design system, UI overhaul & dashboard visualisation
*Added 2026-08-12 at the user's instruction: the CRM is "flat and boring", has no
icons or graphics, and no charts on any dashboard. **This is the next sprint** —
it runs before 11, 12 and 13. Migration: none.*

**Run this with the `/impeccable` skill.** That is the user's explicit
instruction, and it is also the right tool: this is a design pass over an
existing product, not a greenfield build.

#### Why it goes here rather than later

Every remaining R1 sprint adds screens. Sprints 11, 12 and 13 together add the
notice board, nine report types and three portals. Doing the design system after
them means redesigning those screens twice — and Sprint 12's charts cannot be
built at all until the charting decision below is made. **This is the cheapest
week this work will ever cost, and it gets more expensive every sprint.**

#### What we are starting from — measured 2026-08-12

- **8 UI primitives** in `components/ui/`: Badge, Button, Card, Input,
  SecretInput, Select, Textarea, Toggle. No Table, Modal, Tabs, Tooltip, Toast,
  EmptyState, Skeleton, Avatar, Breadcrumb or Pagination — 105 components have
  been improvising them.
- **Essentially no icons.** Exactly one of 105 component files contains an
  `<svg>`. There is no icon library in `package.json`.
- **No charting library**, and no chart anywhere in the product.
- **The token layer is good and must be kept.** `tailwind.config.ts` already
  exposes `brand.primary/secondary/accent/background/text` plus three computed
  `on*` foregrounds as CSS variables, per tenant, from `lib/branding.ts`.
  `shadow-card` and `rounded-card` exist. This is a real foundation — extend it,
  do not replace it.

#### ⚠️ Two constraints that make this harder than a normal redesign

**1. There is no single palette to design against.** Each school picks its own,
at runtime, and it can be anything — a maroon, a bottle green, a pale gold. A
design that looks considered in slate-and-indigo and illegible in a school's
actual colours is a regression, not a redesign. This is exactly why the `on*`
foregrounds are computed rather than stored, and why `text-white` was removed
once already (§5p — the branding template that reached one colour of five).

*Rule:* every new component consumes brand tokens. **Verify against at least
three deliberately hostile palettes** — a very dark primary, a very light one,
and a saturated mid-tone — before anything is called done.

**2. Print output must not move.** `PrintSheet` renders fee challans, report
cards, admit cards and payslips — the artefacts a school is judged on, and the
largest unverified surface in the project. A global stylesheet change already
broke every printed challan once (§5e: `display: none` unqualified by media,
which shipped blank vouchers from the day the framework landed and was not
caught for two days).

*Rule:* print styles are touched deliberately or not at all, and **every print
template is re-checked at the end of this sprint**, not assumed.

#### Deliverables

> **Status 2026-08-13: A and D are done, B is not started, C is built but wired
> to nothing.** See `STATE.md` §5z for what exists, the two decisions the user
> took, and the rule every later screen must follow. The rest of this section is
> the original plan and remains the spec.

**A. Design system**
- ~~Decide and install an **icon library**.~~ ✅ **`lucide-react`**, 2026-08-13.
  Recorded in `components/ui/Icon.tsx`, which is the wrapper everything imports
  so that size and stroke weight cannot drift across 105 components.
- Extend the token layer: spacing scale, type scale, elevation, border and
  focus-ring tokens. Keep them CSS variables so per-tenant branding still works.
- **Fill the primitive gaps**: Table, Modal/Dialog, Tabs, Tooltip, Toast,
  EmptyState, Skeleton, Avatar, Breadcrumb, Pagination, Stat/KPI tile.
- **Dark mode is out of scope** for this sprint. Per-tenant palettes plus dark
  mode is two variable systems multiplying; ship the palette work first.

**B. The application shell**
- Sidebar and top bar across all five shells (school-admin, teacher, student,
  parent, super-admin) — icons on every nav item, active state, grouping,
  collapse.
- Page headers with breadcrumbs and a consistent primary-action slot.
- **Empty, loading and error states everywhere.** The single largest cause of a
  product feeling unfinished, and the cheapest to fix.
- Accessible focus states and keyboard navigation. Not decoration — the current
  primitives have no visible focus ring worth the name.

**C. Dashboard visualisation — the part the user asked for by name**

The competitor's demo leans on this heavily and the transcript names the
specific views: a graphical monthly income-vs-expense view, an attendance
overview, monthly income against student count, class-wise strength with
expected/collected/balance, and a report card carrying a graphical breakdown
with percentage and rank.

Ours to build:

| Surface | Visualisation |
| --- | --- |
| School-admin dashboard | KPI tiles (students, staff, today's collection, outstanding), monthly collection trend, attendance rate over time, class-wise strength, admissions funnel |
| Fees | Collected vs outstanding vs overdue, aging buckets, collection by month |
| Attendance | Per-class attendance rate, absence trend, monthly heatmap |
| Exams | Grade distribution per exam, subject-wise averages, pass rate |
| Report card | Per-subject bar plus percentage and class rank — **it prints**, so it must be static SVG (see below) |
| Parent portal | Their child's attendance ring and result trend |
| Super Admin | Schools by module adoption, active users per school |

**D. The charting decision — settle it here, not in Sprint 12**

`SPRINTS.md` Sprint 12 currently defers this and it blocks that sprint. It is a
design-system decision, so it belongs in this one.

The recommendation is **server-rendered SVG components, not a charting library**,
for three reasons that are specific to this codebase:

1. **A chart on a report card has to print**, and print goes through
   `PrintSheet`. A canvas-based or client-hydrating chart is unreliable in a
   print context; static SVG is exactly what the print path already handles.
2. **Bundle budget.** `recharts` is roughly 100 kB gzipped against a <200 kB
   first-load target, and the deps list is currently 14 packages with no
   client-side rendering library among them.
3. The chart types actually needed are bar, line, donut and a heatmap grid.
   That is a few hundred lines of SVG with the brand tokens applied — and it
   inherits per-tenant colour for free, which a library would need configuring
   for on every instance.

**If a genuinely interactive chart is needed later** (zoom, brush, live
tooltips), add a library then, for that chart only. Do not adopt one now for
charts that are read, not manipulated.

**E. Verification** — `/impeccable` in the browser across all five shells, at
mobile and desktop widths, against three hostile palettes, plus a print check of
every template. `npm run typecheck && npm run lint && npm run build` green.

#### What this sprint is not

Not a rewrite. Not new features. Not new routes. If a screen's *behaviour*
changes, that is a defect in this sprint, not a bonus — the data, permissions
and tenancy paths are working and QA'd, and this pass must leave every one of
them untouched.

### Sprint 11 — Communications: announcements, notice board, campaigns
*Derives from: document Sprint 11, rebuilt off GoHighLevel.
Migration: `0018_sprint11_comms.sql`.*

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
- ~~**`recharts` is not installed** … decide it in this sprint.~~
  **Decided in Sprint 10.5 instead** (2026-08-12), where it belongs — it is a
  design-system decision and it was blocking this sprint. The answer is
  **server-rendered SVG chart components** built on the brand tokens, chiefly
  because a chart on a report card has to survive `PrintSheet`. Sprint 12 *uses*
  those components; it does not choose them.

**The dashboards themselves are Sprint 10.5's**, not this sprint's. Sprint 12
owns the nine tabular/printable report types; 10.5 owns the KPI tiles and charts
on the school-admin, fees, attendance, exams, parent and Super Admin dashboards.
The split is deliberate: reports are documents, dashboards are visualisation, and
they were tangled together in §2.9 before this was written down.

CSV export stays as specified: native `Response` with `text/csv`.

---

### Sprint 13 — Portal completion + PWA shell + multiple principals
*Derives from: document Sprints 13, 14, 15 merged, plus BR4.
Migration: `0019_sprint13_portals.sql`.*

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

### Sprint 13.5 — Accounting: ledger, expenses, financial reports ✅ BUILT 2026-08-21
*Added 2026-08-12 (§0.9). Derives from `ROADMAP.md` §2b and the competitor gap
review §A. Migration `0027` — **written, not yet applied**; see `STATE.md` §5au.*

**Built as specified, with two documented departures:**

1. `ledger_entries` gained a header table, `ledger_transactions`. One date, one
   memo and one cause per entry; two or more sides. Repeating the date per line
   lets the two halves of a transaction fall on different days, and splits are
   real here — payroll is one entry with a line per deduction head.
2. **The module flag is the existing `accounts`, not a new `accounting`.**
   `lib/platform-modules.ts` has carried "Accounts & Finance" since Sprint 2;
   a second key would be two switches for one thing plus a `school_modules`
   CHECK change, and a school with the old flag on and the new one off would
   watch the module vanish on deploy.

One decision the document did not specify and that a later sprint must not
reverse by accident: **income is recognised when the money is received, not
when it is billed.** A fee payment posts; raising a challan posts nothing. The
accrual alternative would put eight hundred entries in the day book per bulk
generation and would give the school two answers to "how much is outstanding".
The fee module's answer, which has a challan number against every rupee, stays
authoritative. `0027`'s header argues it in full.

**Non-negotiable, and it comes before anything that moves money.** Sprints 16
(payments/wallet) and 20 (POS) both post to the ledger this sprint creates.

- `ledger_accounts` — chart of accounts per school: cash, bank, fee income,
  salary expense, and school-defined heads
- `ledger_entries` — **append-only**, double-sided, never edited or deleted.
  A correction is a reversing entry. This is the only way a disputed balance is
  explainable months later, and it is the same rule as the parent wallet (§Sprint 16).
- `expenses` + `expense_categories` — entry, category, attachment, approver
- **Fee payments post to the ledger** — `fee_payments` gains a ledger reference.
  Backfill existing rows in the migration.
- **Per-staff cash accounts and settlement** — an accountant's takings, their own
  balance sheet, and the settlement against the office. The competitor
  demonstrates this and it is how a Pakistani school actually runs a fee counter.
- Reports on `PrintSheet`: balance sheet, profit & loss, day-book, day-by-day
  account summary, month-by-month year view, expense detail by category,
  income/expense summary for tax
- Permission keys: `accounting.read`, `accounting.write`, `accounting.settle`
- Module flag: `accounting`

**Do not build expenses as a flat table with a running total.** The ledger is
the point; expenses are its first, cheapest consumer, and they exist here to
prove it before real money depends on it.

### Sprint 13.6 — Internationalisation + per-school language
*Added 2026-08-12 (§0.9). Migration: next free number.*

**Sequenced here deliberately: this gets more expensive per screen added, and R2
adds a lot of screens.** Doing it after Sprint 20 costs several times what it
costs now.

- **Language section against each school in Super Admin**, listing all supported
  languages — the user's requirement, not an Urdu toggle. `schools.locale` +
  `schools.text_direction`.
- **i18n on the app shell**: navigation, buttons, form labels, validation
  messages, and **every `PrintSheet` template**. Machine translation must never
  touch these — the browser cannot distinguish a label from data and will
  translate student names, school names and currency amounts. A garbled fee
  challan at a bank counter is a real failure, not a cosmetic one.
- **`<html lang>` and `dir` set from the school's setting**, so the browser
  offers the right translation for long-form and user-generated content, and so
  RTL layout switches for Urdu, Arabic and Pashto.
- **RTL is the expensive half.** Audit every flex direction, icon, chevron,
  table alignment and print margin. Budget most of the sprint here, not on strings.

Pick the i18n library in this sprint and record the choice — `next-intl` is the
obvious fit for the App Router, but it is a decision, not a default.

### Sprint 14 — Internal chat, part 1
*Derives from: `ROADMAP.md` §5 build order 1–3. Absent from the document.
Migration: `0020_sprint14_chat.sql`.*

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
*Derives from: `ROADMAP.md` §5 build order 4–7. Migration: `0021_sprint15_push.sql`.*

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
*Derives from: `ROADMAP.md` Tier 2 #4 and §2b. Migration: `0022_sprint16_payments.sql`.*

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

### Sprint 16.5 — Documents: certificates + ID card designer
*Added 2026-08-12 (§0.9). Derives from the gap review §D. Migration:
next free number.*

The cheapest visible parity on the whole list — `PrintSheet` already exists, so
most of it is a template each.

- **Student certificates**: school leaving, character, date of birth
- **Staff certificates**: experience, service. Bulk generate, then edit each
  before print — the competitor's flow, and it is the right one.
- **Admission form print**, blank and pre-filled
- **ID card designer** — this is the real work, and it is a small product:
  upload a background, place fields on it, live preview, batch print by class or
  by staff group. Students and staff share the designer; only the field set differs.
- **The QR on the student card is the gate-attendance token** (§0.9). Design the
  two together or the scanner sprint inherits an unscannable card.
- Module flag: `documents`

**Print fidelity is only provable against a real card printer.** Budget a
physical test before this is called done; a card that looks right on screen and
prints 2 mm off-register is not finished.

### Sprint 17 — LMS part 1: courses & content
*Derives from: document Sprint 8, unchanged in substance. Migration: `0023_sprint17_lms.sql`.*

`lms_courses`, `lms_sections`, `lms_lessons`, `lms_assignments`, `lms_quizzes`,
`lms_questions`, `lms_enrollments`. Course builder with ordering, video/document/
text/quiz lesson types, bulk enrolment by grade or section.

### Sprint 18 — LMS part 2: student experience
*Derives from: document Sprint 9. Migration: `0024_sprint18_lms_submissions.sql`.*

`lms_submissions`, `lms_quiz_attempts`, `lms_progress`. Course player, progress
tracking, assignment upload, timed quiz player, certificate on completion.

**Correction:** the document says certificates are "PDF certificate … Supabase
Storage". Use `PrintSheet` for the same reason as §Sprint 12 — no headless
renderer on Hostinger.

### Sprint 19 — Events & calendar
*Derives from: document Sprint 10. Migration: `0025_sprint19_events.sql`.*

`events`, `event_attendees`, `event_reminders`. Calendar view, RSVP, attendance
marking, post-event gallery.

**Correction:** the document routes publish notifications through "GHL bulk
email". Route them through the Sprint 11 announcement path — our SMTP by
default, chat announcement channel, GHL only if connected.

### Sprint 19.5 — E-learning: homework diary, study material, online classes
*Added 2026-08-12 (§0.9). Derives from `ROADMAP.md` §2b "E-Learning & Homework"
and the gap review §C. Migration: next free number.*

Splits out of the old `lms` flag, which conflated "courses and quizzes"
(Sprints 17–18) with the daily things a school actually uses.

- **Homework diary** — teacher posts per class per subject; parents and students
  see it in the portal and the app; one action sends the whole day's diary to a
  class. Delivery over chat + email (§0.9), never SMS.
- **Study material** — video, PDF, image, external link, scoped to a class or a
  subject, in Supabase Storage
- **Student / parent leave applications** submitted from the portal or app and
  approved by the school. Distinct from staff leave, which exists.
- **Online classes** — self-hosted Jitsi Meet on a dedicated VPS with **JWT
  auth**, rooms derived from `(location_id, class, date)`, joined from the
  timetable. Costed in §0.9: per-minute vendors are ~$400/school/month, a VPS is
  ~$50/month for the platform.
- Module flags: `e_learning`, `online_classes`

**The VPS is infrastructure the platform now operates.** That is a real
operational commitment — a box to patch and monitor — and it is the price of not
paying per participant-minute.

### Sprint 19.6 — Biometric device integration
*Added 2026-08-12 (§0.9). Migration: next free number.*

Architecture in §0.9. Ship the ZK push adapter only; further vendors are
demand-driven and cost one adapter file each.

- `biometric_devices`, `biometric_events` (append-only raw payloads)
- `POST /api/school/biometric/ingest` — device-authenticated by shared secret,
  **not** a session; it is a webhook receiver
- Adapter registry in `lib/biometric/adapters/`
- Enrolment mapping on `staff` and `students`
- Attendance **derived** from events, so a mis-mapped device is replayed
- Module flag: `biometric`

**Before starting:** confirm the first school's device model and that its
firmware exposes push/ADMS rather than poll-only.

### Sprint 19.7 — Cross-platform app + gate attendance
*Added 2026-08-12 (§0.9). Migration: next free number.*

**Depends on Sprint 16.5** — the QR the scanner reads is printed by the ID card
designer. **Depends on Sprint 15** — push tokens.

- **Capacitor wrapper around the existing PWA.** Not React Native; not a second
  UI. Four role shells off one binary — parent, student, staff, gatekeeper —
  chosen at login from the `school_users` row.
- **Native push via FCM/APNs**, which retires the iOS home-screen caveat carried
  in Sprint 15.
- **Gate scanning**: native continuous QR scan with torch control, **plus
  hardware USB/Bluetooth scanners as a first-class input** (they present as
  keyboards — a hidden focused input taking scan-and-enter). A school with 900
  students at 07:45 will use the hardware scanner, not a phone.
- **Offline queue**: local append-only log, each scan carrying a
  client-generated UUID, device id and monotonic timestamp; drains on
  reconnect; server dedupes on the UUID. Attendance is idempotent on
  `(student, date, session)` regardless. **The gate works with the network
  unplugged.**
- **Gatekeeper role** — scan only; no roster, marks or fees.
- Entry/exit direction, and the absence alert fired when the register closes
  (over chat + email, per §0.9).
- Module flag: `mobile_app`. A school without it gets the web portal, and the
  app says so at sign-in rather than half-working.

**External, and the user's to start:** Apple Developer account ($99/yr) and
Google Play ($25 one-off). Apple review is the slow step — register early, well
before this sprint runs.

**🚩 Release 2 gate — feature parity with OurSchoolSoftware, demo-able.**

---

## Release 3 — Scale & Monetise

### Sprint 20 — POS, inventory & merchandise checkout
*Derives from: `ROADMAP.md` §2b. Absent from the document. Migration: `0026_sprint20_pos.sql`.*

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
*Derives from: document Sprint 16. Migration: `0027_sprint21_saas.sql`.*

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

## 2.9 Gap-review items folded into existing sprints

*Added 2026-08-12.* The competitor review (§0.9) also surfaced smaller items that
do not deserve sprints of their own. They are listed here so they are not lost
between now and the sprint that owns them.

| Item | Owning sprint |
| --- | --- |
| Absence alert, fee-received confirmation, exam-marks-published, admission status — on chat + email | 11 |
| Message templates with merge tags, editable per school | 11 |
| Defaulter reminder **sequences** (first / second / escalation), class-filtered | 11 |
| Delivery log per recipient per channel | 11 |
| Global header search across students and staff, with print actions on the result | 12 |
| Excel export alongside CSV on list screens | 12 |
| Fee discount report, account summary report | 12 (data from 13.5) |
| Dashboard: unpaid invoices, income/expense/profit today, monthly income-vs-expense, class-wise expected vs collected vs balance | **10.5** builds the tiles and charts; the income/expense series needs 13.5's ledger, so those two tiles land empty until then and must say so rather than showing a zero |
| **Subject / lecture-wise attendance** — ours is per-day only; `attendance_records` has no subject or period column | 12 or its own migration; **schema change, do not defer silently** |
| Admission **inquiry** register — walk-in/phone leads, follow-up, conversion to application | 11 or 10 |
| Live webcam photo capture at admission | 10 |
| Campus switcher in the header for multi-campus operators | 13 |
| Parent complaint management | 14 (rides chat) |
| Staff loans / advances with instalment recovery from payroll | 13.5 (posts to the ledger) |
| Lecture-wise salary; absence-based deduction rules | 13.5 |
| Bulk / class-wise payment entry from a bank statement | 13.5 |
| Bank reconciliation remarks on online payments | 16 |
| Custom one-off fees (tour, summer camp, annual charge) | 10 or 13.5 |

**Teacher performance tracking** stays uncosted: the competitor advertises it
without showing what it measures. Needs discovery before it can be planned.

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
Sprint 12 has no migration — DevOps runs a build check only. (Sprint 0 was
listed here too, wrongly: it ships `0015`.)
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

**⚠️ Four of the six entries below were overturned on 2026-08-12 (§0.9).** They
are kept struck through rather than deleted, because the *reasoning* for
deferring them is still the reasoning for how they are now scoped — demand-driven
adapters, one binary rather than two codebases, a ledger before the things that
post to it.

- ~~**Biometric / device attendance**~~ — **NOW PLANNED** (§0.9). The
  architecture is committed; per-vendor adapters stay demand-driven, which is
  what the original caution was actually protecting against.
- ~~**Native mobile apps**~~ — **NOW PLANNED** (§0.9) as a Capacitor wrapper, not
  a second codebase. The PWA-first instinct survives: the app *is* the PWA.
- ~~**Full accounting**~~ — **NOW MANDATORY** (§0.9), positioned at Sprint 13.5
  because the wallet, payments and POS all post to its ledger.
- ~~**Online classes**~~ — **NOW PLANNED** (§0.9), self-hosted Jitsi.
- **Bundled school website** (Tier 3 #10) — still a sales feature, not a product one.
- **Library, transport, hostel** — `ROADMAP.md` §8: no evidence the competitor
  has them. Check before planning a second phase.

---

## 7. Questions

### Answered 2026-08-08 — see §0.8

| | Answer |
| --- | --- |
| Go-live: cut scope or move the date? | **Near-term scope is Release 1.** The date is deleted — see §0.7 |
| Merchant onboarding started? | ~~No~~ → **Yes, begun** (user, 2026-08-12). Still externally paced, no longer the thing nobody has started. |
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
