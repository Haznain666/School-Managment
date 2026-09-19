# SPRINT 34 — Features & Roadmap tabs in Super Admin

**Written:** 2026-09-18
**Migration:** none. `0050` remains the next free number.
**Branch:** `claude/super-admin-features-roadmap-716d0f`

---

## 0. Decisions taken with the product owner (2026-09-18)

1. **"Pillar" did not exist in this repository.** Grepped every `.ts`, `.tsx`
   and `.md` — zero hits. The product owner chose the grouping:

   | Pillar | Modules under it |
   | --- | --- |
   | **Academics & Learning** | `academics`, `lms`, exams & results, `event_mgmt` |
   | **Finance** | `admissions`, `fee_management`, `accounts` |
   | **People & Operations** | `hr_payroll`, `staff_kpis`, `chat`, `transport`, `library`, `hostel` |

   Exams & results is **not** a `school_modules` key — it ships inside
   `academics`. It is listed as its own feature because it is what a school
   buys the module for, and the entry says which flag switches it on.

2. **The content is a static TypeScript module**, `lib/product-catalogue.ts`,
   typed against `UserRole` and `PlatformModuleKey`. No migration, no database
   read, both pages prerender. A renamed role or module key is a `typecheck`
   failure rather than a page that quietly lists a role nobody has.

---

## 1. The audit — what actually exists

Everything below was read out of the code, not inferred.

### 1.1 Roles — 12, from `types/school-auth.ts`

`USER_ROLES`, in the file's own seniority order. `ROLE_LABELS` and
`ROLE_DESCRIPTIONS` already carry a name and a one-line description for each,
and the catalogue **re-uses those two records rather than restating them** —
a second copy of a role description is the copy that goes stale.

| Role | Portal shell | Branch required |
| --- | --- | --- |
| `school_admin` | `/dashboard` | no |
| `branch_admin` | `/dashboard` | **yes** |
| `principal` | `/dashboard` | no |
| `vice_principal` | `/dashboard` | no |
| `section_head` | `/dashboard` | no |
| `coordinator` | `/dashboard` | no |
| `teacher` | `/teacher` | **yes** |
| `student` | `/student` | **yes** |
| `parent` | `/parent` | **yes** |
| `accountant` | `/dashboard` | no |
| `hr_manager` | `/dashboard` | no |
| `marketing` | `/dashboard` | no |

`BRANCH_REQUIRED_ROLES` is the source of the third column.
`INVITABLE_ROLES` excludes `student` and `parent` — those accounts are made by
the admissions flow. `CONFIGURABLE_ROLES` excludes the same two from the
permissions matrix, because nothing they reach is permission-gated.

### 1.2 Modules — 12, from `lib/platform-modules.ts`

Five of them are **switches with no screen behind them yet**:
`lms` and `event_mgmt` push a nav entry marked `placeholder: true`
(`components/school/school-nav.ts`), and `transport`, `library` and `hostel`
have no nav entry and no route at all. Verified: no directory exists under
`app/(school-admin)/dashboard/` for any of the five.

**Those five belong on Roadmap, not Features.** A Features tab that lists
Library as shipped is a tab that loses a deal in the room.

### 1.3 Permissions — the access matrix already exists

`DEFAULT_ROLE_PERMISSIONS` in `lib/permissions.ts` is a literal, per-role list
of ~60 permission keys. `PERMISSION_LABELS` gives every key a plain-English
sentence and `PERMISSION_DESCRIPTIONS` gives 30 of them a paragraph explaining
*why* a role does or does not hold it.

**The role-access matrix on the Features tab is derived from these at render
time, never hand-written.** Each feature entry names the permission keys it is
gated on; the component resolves the roles from `DEFAULT_ROLE_PERMISSIONS`.
That is what makes the tab correct by construction: change a default, and the
matrix changes with it.

Access levels rendered per role per feature:

| Level | Meaning | Derivation |
| --- | --- | --- |
| **Full** | holds every key the feature names | all of `permissions` |
| **Partial** | holds some | at least one but not all, listed |
| **Read-only** | holds only the read-shaped keys | read keys only |
| **Own records** | reaches it through their own portal, not by permission | `portalAccess` on the entry |
| **None** | — | no key, no portal route |

### 1.4 Default portal view per role

- **Administrative shell** (`buildSchoolNav`, 9 roles): Dashboard, then
  Users & Staff / My Branch Staff, Branches, Admissions, Academics, Exams,
  Fees, HR, Leave, Payroll, Staff performance, Accounting, Communications,
  Messages, Reports, Calendar, Settings, Feedback — **each gated on the read
  permission its own layout enforces**, so the sidebar is already per-role.
- **Teacher** (`teacher-nav.ts`): My Dashboard, My Timetable, My Classes,
  Attendance, My Exams, Marks, Gradebook, Promotions (class teachers only),
  Lesson Plans, Calendar, Messages, Announcements, My Performance, My Payslips,
  My Leave.
- **Student** (`student-nav.ts`): My Dashboard, My Timetable, My Exams,
  My Results, Fee Status, Calendar, Messages, Announcements.
- **Parent** (`parent-nav.ts`): My Dashboard, My Children, Attendance, Results,
  Timetable, Fees, Calendar, Messages, Announcements, Settings.

### 1.5 What is built, by pillar

**Academics & Learning** — Academics & Timetable (period structures, subjects,
teacher calendar), Attendance & register, Exams & datesheets, Marks &
gradebook, Report cards & grading schemes, Promotions & promotion criteria,
Lesson plans, Substitute cover, School calendar & holidays.

**Finance** — Admissions & enrollment (public application form, GHL sync),
Student records & bulk import, Campus transfer, Fee structure & vouchers,
Family vouchers & sibling discounts, Concessions & late-fee rules, Aged debt &
defaulters, Accounting (append-only ledger, day book, expenses, chart of
accounts, cash counters), Fee & finance reports.

**People & Operations** — Users, roles & the permission matrix, Multi-campus,
Principal assignments & the chain of command, Staff records & salary
components, Leave management, Staff register & Saturday duty, Payroll runs &
payslips, Payroll approvals, Staff KPIs & performance, Chat & messaging
(desks, grants, moderation, oversight), Announcements & email, Web push & the
PWA, Reports, Feedback, Global search.

**Platform (Super Admin, cross-tenant)** — School provisioning & subdomains,
Module toggles & bulk apply, Login as Admin, Branding & palette, GoHighLevel
integration, the Feedback queue. Rendered as a fourth section on the Features
tab, headed *Platform* and marked as operator-only — it is not one of the
three pillars and must not be sold as a school-facing one.

### 1.6 Roadmap source

`SPRINTS.md` Releases 2 and 3, plus the five unbuilt module flags. **Sprint
numbers and dates are stripped** — the product owner's instruction, and
`no-release-dates-for-the-sms-platform` in memory. Names and "who it's for"
only.

---

## 2. What to build

### 2.1 `lib/product-catalogue.ts` — the content module

```ts
export type PillarKey = 'academics' | 'finance' | 'people_ops' | 'platform';

export interface Pillar { key: PillarKey; label: string; tagline: string; blurb: string; }

export interface FeatureEntry {
  key: string;                       // anchor id, kebab-case
  pillar: PillarKey;
  name: string;
  module: PlatformModuleKey | null;  // null = ships regardless of any flag
  summary: string;                   // one line, internal register
  salesLine: string;                 // one line a prospect hears
  capabilities: readonly string[];   // what it actually does, 3-8 bullets
  permissions: readonly Permission[];// the matrix is DERIVED from these
  portalAccess?: Partial<Record<UserRole, string>>; // "own records" notes
  limitations?: Partial<Record<UserRole, string>>;  // per-role caveats
  routes: readonly string[];
  glossary?: readonly string[];      // glossary term keys this entry uses
}

export interface RoleProfile {
  role: UserRole;                    // label + description come from ROLE_LABELS / ROLE_DESCRIPTIONS
  portal: 'Administration' | 'Teaching' | 'Student' | 'Family' | 'Platform';
  homeRoute: string;                 // ROLE_HOME_ROUTES
  branchRequired: boolean;           // BRANCH_REQUIRED_ROLES
  invitable: boolean;                // INVITABLE_ROLES
  defaultView: readonly string[];    // what their sidebar shows on day one
  limitations: readonly string[];    // the boundaries that actually bind
}

export interface RoadmapEntry {
  key: string; pillar: PillarKey; name: string;
  summary: string; forWhom: string;
  module?: PlatformModuleKey;        // set when a flag already exists
}

export interface GlossaryTerm {
  key: string; term: string; definition: string;
  category: 'Pillar' | 'Module' | 'Role' | 'Platform' | 'GoHighLevel';
}
```

**Compile-time safety required, not optional.** Add at the bottom of the file:
a check that every `FeatureEntry.module` is a real `PlatformModuleKey`, that
every `permissions` entry is a real `Permission`, and that `ROLE_PROFILES`
covers all 12 `USER_ROLES` exactly once. Types do most of this; the `satisfies`
operator and a `Record<UserRole, …>` do the rest.

### 2.2 `components/super-admin/ProductGuide.tsx` — one component, both tabs

A client component. Both tabs render it with different data, so search,
filters, glossary and anchors behave identically — the product owner's
consistency requirement, and the only way two tabs stay in step.

- **Full-text search** over name, summary, sales line, capabilities, role
  names and glossary terms. Debounced, client-side, no endpoint.
- **Filter by pillar** and **filter by role** (role filter narrows to features
  that role can reach at all). Both reflected in the URL **hash**, not
  `searchParams` — `searchParams` opts the page out of prerendering and costs
  ~1s a request (CLAUDE.md, and `super-admin/login/page.tsx` is the worked
  example). The hash is read in an effect, so the page stays static.
- **Persistent glossary panel** — a docked right rail on `lg` and up, a
  bottom sheet below it. Terms in body copy that match a glossary key are
  rendered as buttons that scroll the panel to that term.
- **Anchor quick-nav** — a sticky pillar/feature index; every feature and role
  has an `id`, so any of them is one click from the top of the page and two
  from anywhere.
- **Empty state** when a search or filter matches nothing, naming what was
  searched and offering to clear it.

### 2.3 The two pages

`app/(super-admin)/super-admin/features/page.tsx` and
`.../roadmap/page.tsx`.

**Both are prerendered.** No `await`, no `searchParams`, no `cookies()`, no
database read, no `export const dynamic`. Therefore, per CLAUDE.md's
second direction, **neither gets a `loading.tsx`** — a skeleton on a
prerendered page is a flash of fake content in front of content that had
already arrived. `npm run check-loaders` enforces both directions and will
fail if a `loading.tsx` is added.

### 2.4 The side menu

`components/super-admin/SuperAdminSidebar.tsx`, `NAV`, after `Feedback`:

```
Dashboard -> Schools -> Modules -> Feedback -> Features -> Roadmap
```

Icons come from `NAV_ICONS` in `components/school/nav-icons.ts`. If no
suitable icon exists, add one there — do not inline an SVG in the sidebar.

---

## 3. Ground rules

- **Do not invent a feature, a role or a permission.** Everything on the
  Features tab must be traceable to a route, a module key or a permission key.
  Anything unclear goes in the final report as a flag, not into the file.
- Read large files with `grep` and scoped `sed -n` ranges.
- Match the Super Admin section's existing design system — platform tokens
  (`surface`, `ink`, `line`, `brand-*`), never a school palette, and never a
  hardcoded `bg-white` or `text-slate-*`. `npm run check-theme` enforces this.
- Reads well as an internal reference **and** as sales copy walked through with
  a prospect. Two registers per entry: `summary` and `salesLine`.
- Responsive from 375px up. No horizontal page scroll.

## 4. Gates

All thirteen in CLAUDE.md's green-build list, plus `check-portals` and
`check-theme`. No new check script — this sprint adds no SQL, so there is no
statement to execute.
