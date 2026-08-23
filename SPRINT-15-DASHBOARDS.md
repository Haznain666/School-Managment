# Sprint 15 — dashboards for all five portals

**Status:** specification. Written 2026-08-23 with the `business-analyst`,
`dashboard-designer` and `chart-builder` skills, against the queries that
actually exist in `lib/` rather than against a wish list.

---

## 0. The rule that governs every screen below

**A tile that cannot be computed says so. It never shows a zero.**

This is not a style note. `PKR 0` on a school that collected three lakh this
morning is *confidently wrong and unfalsifiable by the reader* — they have no
way to tell a real zero from a broken query. `StatTile` already has an
`unavailable` state and a reason string; use it. The school-admin dashboard
learned this the hard way on 2026-08-22, when one missing table took the whole
screen down (STATE.md, and the `settle()` helper at the top of
`app/(school-admin)/dashboard/page.tsx`).

Every dashboard read is therefore:

- wrapped so one failure removes one tile, never the page — `Promise.all`
  rejects on the first rejection and that is exactly the outage;
- gated on the module being enabled *and* the caller holding the permission;
- tenant-scoped from the verified session, never from a request parameter.

---

## 1. Business analysis

### 1.1 Stakeholder register

| Stakeholder | Portal | Interest | Influence | Cadence | The standing question |
| --- | --- | --- | --- | --- | --- |
| Platform operator | Super Admin | High | High | Daily | Is the estate growing, and is any tenant broken? |
| School owner / administrator | School Admin | High | High | Daily, first thing | Is money coming in, are children present, is anything on fire? |
| Principal | School Admin (scoped) | High | Medium | Daily | Same, for **my** campus only — BR4 scoping |
| Teacher | Teacher | High | Low | Several times a day | What do I have to do today, and what is late? |
| Parent | Parent | Medium | Low | Weekly, or on a notification | Is my child fine, and do I owe anything? |
| Student | Student | Medium | Low | Weekly | What is next, and how did I do? |

### 1.2 Archetypes (`dashboard-designer` step 1)

| Portal | Archetype | Headline KPIs | Layout |
| --- | --- | --- | --- |
| Super Admin | Operational | 4 | F-pattern |
| School Admin | Operational | 5 | F-pattern |
| Teacher | Operational, task-led | 3 | Task list first, metrics second |
| Parent | Strategic (light) | 3 per child | Per-child card stack |
| Student | Strategic (light) | 3 | Z-pattern |

### 1.3 The vanity metrics deliberately excluded

Filtered out at step 2 of KPI selection, because no viewer can act on them:

- **Total schools ever created** on Super Admin — an operator acts on *active*
  tenants and on *broken* ones. Total is a trophy.
- **Modules enabled across the platform** — this was already removed once (see
  the docblock in `app/(super-admin)/super-admin/page.tsx`) and must not return.
- **Lifetime fees collected** on School Admin — unactionable. This month
  against last month is actionable.
- **Total announcements sent** anywhere.

---

## 2. Super Admin dashboard

**Decision it informs:** which tenant needs attention today, and is the
platform healthy.

### 2.1 Headline KPIs (level 1)

| # | KPI | Source | Comparison | Alert condition |
| --- | --- | --- | --- | --- |
| 1 | **Active schools** | `schools` where `is_active` | vs. 30 days ago | — |
| 2 | **Tenants needing attention** | `subdomain_status IN ('failed','throttled','pending','unmanaged')` **+** schools with no branch **+** schools with no admin user | — | Red when > 0 |
| 3 | **Students across the platform** | `students` where `status = 'enrolled'` | vs. 30 days ago | — |
| 4 | **Email delivery health** | existing `EmailDeliveryHealth` — queued / failed in outbox | — | Red when failed > 0 |

KPI 2 is the one this dashboard was missing. An operator's real job is
exception handling, and today nothing on the screen surfaces a broken tenant —
the failed subdomain in the product owner's screenshot was only visible by
scrolling the schools table. **The tile links straight to a filtered list.**

### 2.2 Supporting charts (level 2)

| Panel | Chart | Why this type (`chart-builder` step 1) |
| --- | --- | --- |
| Tenant growth, 12 months | `LineChart` | x-axis is time, message is trend. Keep the existing query. |
| Enrolled students by school, top 6 | `BarChart`, horizontal | Ranking with long labels (school names). Sorted by value. |
| Provisioning state of the estate | `DonutChart` | Part-of-whole, ≤ 5 slices: Ready / Provisioning / Failed / Manual. Exactly what a donut is for. |
| Schools by city | `BarChart`, horizontal | Ranking. Merge the tail into "Other" rather than drawing a sliver per city. |

### 2.3 Detail (level 3)

- **Tenants needing attention** — a table, most recently broken first, each row
  linking to that school. This replaces "5 most recently created schools",
  which answers a question nobody asks twice.
- Keep the recent-schools list, demoted, below it.

### 2.4 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Active schools │ Needs attention │ Students │ Email health       │
├───────────────────────────────┬──────────────────────────────────┤
│ Tenant growth (12 months)     │ Provisioning state (donut)       │
├───────────────────────────────┼──────────────────────────────────┤
│ Students by school (bar)      │ Schools by city (bar)            │
├───────────────────────────────┴──────────────────────────────────┤
│ TABLE — tenants needing attention                                │
├──────────────────────────────────────────────────────────────────┤
│ Recently created schools (demoted)                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. School Administrator dashboard

**Decision it informs:** where today's attention goes — money, attendance, or
an exception.

Keep everything that already works (`getTodaySnapshot`, `getCollectionTrend`,
`getAttendanceTrend`, `getClassStrength`, `getFeeOverview`,
`getAccountingOverview`, the `settle()` failure isolation, the module and
permission gates). This is a **restructure and an extension**, not a rewrite.

### 3.1 Headline KPIs (level 1)

| # | KPI | Source | Comparison | Alert |
| --- | --- | --- | --- | --- |
| 1 | **Collected this month** | `getCollectionSummary` | vs. same point last month | — |
| 2 | **Outstanding** | `getFeeOverview` | count of defaulters beside it | Red past due day |
| 3 | **Attendance today** | `getTodaySnapshot` | vs. 30-day average | Amber below 85% |
| 4 | **Enrolled students** | `getDashboardCounts` | vs. start of academic year | — |
| 5 | **Net this month** | `getAccountingOverview` | vs. last month | `unavailable` unless module on **and** `accounting.read` **and** chart of accounts set up |

Every one carries a comparison. A KPI without a benchmark is a number, not an
indicator — and four of the five tiles on the current screen have none.

### 3.2 Supporting charts (level 2)

| Panel | Chart | Why |
| --- | --- | --- |
| Collections, 12 months | `LineChart` | Trend over time. Exists — keep. |
| Fee status split | `DonutChart` | Part-of-whole, 3 slices (Paid / Partial / Unpaid). `getFeeStatusSplit` exists and is currently unused on this screen. |
| Ageing of receivables | `BarChart` | Ordered buckets (0–30, 31–60, 61–90, 90+). `getAgingBuckets` exists, unused. **Ordered x-axis, so do not sort by value.** |
| Attendance, 30 days | `LineChart` | Trend. Exists — keep. |
| Attendance by class, today | `BarChart`, horizontal | Ranking; the point is finding the *worst* class, so sort ascending and colour below-threshold bars in the warning token. `getAttendanceByClass` exists, unused. |
| Class strength | `BarChart` | Exists — keep. |
| Admissions funnel | `BarChart`, horizontal, descending | A funnel is an ordered part-of-whole; a horizontal bar reads it correctly and a pie does not. `getAdmissionsFunnel` exists, unused. |
| Recent exam outcomes | keep as-is | `getRecentExamOutcomes` exists. |

**Five aggregates already written and tested by `check-dashboard` are not on
any screen.** That is the cheapest half of this sprint.

### 3.3 Exceptions strip (level 3) — new

A single row, above the charts, of things that are *wrong right now*, each a
link, each hidden when its count is zero:

- Challans overdue today
- Sections with attendance not marked today
- Exam papers with marks not entered past their deadline
- Staff leave requests awaiting approval
- Failed emails in the outbox

An administrator's morning is exception handling. Today they find these by
visiting five screens.

### 3.4 Principal scoping — BR4

This dashboard is served to the `principal` role too. **Every count, chart and
exception must pass through `resolvePrincipalScope`** from
`lib/principal-resolver.ts`. A principal at a `multiple`-principal school sees
their own campuses and grades and nothing else. `scoped: false` (every
non-principal, and every school on `principal_model = 'single'`) narrows
nothing, so behaviour for a school admin is unchanged.

A principal must **not** see: the school profile edit action, the roles and
permissions action, or any principal-management action. Those are already
gated by `settings.write`, `permissions.manage` and `principals.manage`, none
of which the role holds — so gate the dashboard's quick actions on the same
permissions rather than on the role name.

---

## 4. Teacher dashboard

Today: three placeholder cards and a greeting. Every query below already
exists.

**Decision it informs:** what do I do next.

### 4.1 Headline KPIs

| KPI | Source |
| --- | --- |
| Periods today | `listTeacherTimetable` / `listSlotsForTeacher` |
| Attendance not yet marked today | `listTeacherSections` + today's attendance |
| Marks outstanding | `listTeacherPapers` |

### 4.2 Panels

1. **Today's timetable** — period, time, class, subject, room; the current
   period highlighted; each row linking to its attendance screen. Use
   `listSlotsForTeacher`, **never** unscoped `listTimetableSlots` (CLAUDE.md).
2. **Needs you** — unmarked attendance, unentered marks, lesson plans due for
   the coming week, pending leave. Empty state is a success message, not a
   blank.
3. **My classes** — sections taught, strength, and last attendance date.
4. **Announcements** — real, from the announcements module.

No charts. A teacher's screen is a to-do list; a trend line on it is decoration.

---

## 5. Parent dashboard

**Decision it informs:** is my child fine, and do I owe anything.

Structure: **one card per child** (a parent with three enrolled children must
not have to switch context three times), each with:

| Element | Source |
| --- | --- |
| Attendance this month, % + `Sparkline` | `listStudentAttendance` |
| Fees due, amount + due date | `getStudentFeeSummary` |
| Latest published result | `listPublishedTermsForStudent`, `getStudentReportCard` |
| Next exam | `listStudentExams` |

Plus one school-wide announcements panel below the cards.

`Sparkline` rather than a full chart: the message is "roughly steady / falling",
which is all a sparkline claims to say, and it fits inside a card.

**Only published results.** An unpublished result reaching a parent is a defect
with consequences, and `listPublishedTermsForStudent` is the guard.

---

## 6. Student dashboard

| Element | Source |
| --- | --- |
| Today's timetable | `listSlotsForSection` (**scoped** — CLAUDE.md) |
| Attendance this month | `listStudentAttendance` |
| Next exam, with date | `listStudentExams` |
| Latest published result | `listStudentResultHistory` |
| Result trend across terms | `LineChart` — ordered by term, so a line is right |
| Announcements | announcements module |

---

## 7. Cross-cutting requirements

1. **Loaders.** Every one of these pages fetches on the server, so each segment
   needs a `loading.tsx` using `SkeletonStatTiles` + `SkeletonChart`.
   `npm run check-loaders` enforces it in both directions.
2. **Failure isolation.** Reuse the `settle()` pattern from the school-admin
   dashboard on *every* portal, not just that one.
3. **No raw `sql` templates for comparisons.** Use `eq`, `lte`, `gte`,
   `inArray`. A `Date` passed through a raw template throws
   `ERR_INVALID_ARG_TYPE` and names neither the column nor the file. Reserve
   `` sql`` `` for `count(*) filter (…)`, `date_trunc`, `to_char` and casts.
4. **Every new aggregate is registered in `scripts/check-dashboard-queries.ts`**
   (or `check-portals.ts` for the portal-scoped ones) and executed against the
   real schema with a location id belonging to nobody. Hand-written SQL
   fragments are checked by nothing else in this repo.
5. **Colour.** Use the existing theme tokens only — `npm run check-theme`
   asserts contrast. Status colours carry a label or an icon as well, never
   colour alone.
6. **Chart titles state the insight** where the insight is computable
   ("Collections up 12% on last month"), and the plain metric name where it is
   not. A title that asserts a trend the data does not show is worse than a
   label.
7. **Mobile.** Tiles stack; charts go full width; the parent portal is the one
   most likely to be read on a phone in the first place.

---

## 8. Out of scope

- No new BI tool. The product renders its own charts from
  `components/charts/*`; nothing here needs Chart.js, Recharts or a dependency.
- No new database tables. Every number above is derivable from the current
  schema. **This sprint needs no migration for the dashboards.**
- No auto-refresh. These are screens people read, and a tile that moves under
  the reader adds load without adding information.
