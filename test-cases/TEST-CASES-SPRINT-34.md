# Test cases — Sprint 34: Features & Roadmap tabs in Super Admin

Requirement: `SPRINT-34-SPEC.md`. Surface under test: the **Super Admin**
panel, which is cross-tenant — there is no school to pick and no tenant data on
either screen.

**No migration.** `0050` remains the next free number, and there is no DDL, no
row written and no permission key added. There is therefore nothing to prove by
attempt against the live schema, and no `check-sprint34` script: this sprint
issues no SQL.

**Every browser case is run on a hard-loaded page** — type the URL, then act.
Both tabs read their filters out of the URL hash in an effect, which is exactly
the code path a hard load exercises and a client-side navigation does not.

Legend: **A** = automated (`typecheck` / `check-loaders` / module-load
assertions in `lib/product-catalogue.ts`), **B** = browser.

Local QA harness: standalone build on `http://localhost:3100`, signed in with a
**locally minted** `SUPER_ADMIN_PASSWORD_HASH` in `.env.qa.local` (gitignored).
The real operator password was never read or used.

---

## 1. Navigation and placement

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 1.1 | Super Admin sidebar, top to bottom | Dashboard, Schools (All Schools / Add School), Modules, Feedback, **Features**, **Roadmap** — in that order | B |
| 1.2 | Features sits immediately after Feedback | no entry between them | B |
| 1.3 | Roadmap sits immediately after Features | no entry between them | B |
| 1.4 | Open `/super-admin/features` | Features entry is `aria-current="page"` | B |
| 1.5 | Open `/super-admin/roadmap` | Roadmap entry is `aria-current="page"` | B |
| 1.6 | Both entries render an icon from `NAV_ICONS` | no inline SVG in `SuperAdminSidebar.tsx` | A (grep) |
| 1.7 | Mobile drawer (< `md`) | same two entries, same order — one `NAV`, not two | B |
| 1.8 | Signed out, GET `/super-admin/features` | redirect to `/super-admin/login`, catalogue never served | B |

## 2. The catalogue is derived, not transcribed

The point of the sprint. These are what stop the tab drifting from the product.

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 2.1 | `ROLE_PROFILES` covers `USER_ROLES` | exactly 12, one each, no duplicates | A |
| 2.2 | Rename a role in `ROLE_LABELS` | the tab follows; nothing to edit in the catalogue | A (typecheck) |
| 2.3 | Add a value to `USER_ROLES` without touching the catalogue | **typecheck fails** — `Record<UserRole, …>` is not satisfied | A |
| 2.4 | Every `FeatureEntry.module` is a real `PlatformModuleKey` | load-time assertion | A |
| 2.5 | Every `permissions` entry is a real `Permission` | load-time assertion | A |
| 2.6 | Every `glossary` reference on a feature resolves to a term | load-time assertion — no dead chip can ship | A |
| 2.7 | Feature and roadmap keys are unique | load-time assertion — anchor ids must not collide | A |
| 2.8 | Role matrix for *Academics & timetable* | Teacher **Read-only** (holds `academics.read`, not `.write`); Coordinator **Full**; Accountant **None** | B |
| 2.9 | Role matrix for *Marks entry & gradebook* | Teacher **Partial** — `results.enter` without `results.publish`, which is the whole marks design | B |
| 2.10 | Role matrix for *Attendance* | Parent and Student **Own records**, reached through their portal rather than a permission | B |
| 2.11 | Platform features | one operator-only sentence, not twelve "None" chips | B |

## 3. Honesty about what is built

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 3.1 | Search Features for "library" | **no feature** — Library is unbuilt | B |
| 3.2 | Search Features for "transport" / "hostel" | no feature for either | B |
| 3.3 | Search Features for "LMS" / "events" | no feature — both are `placeholder: true` in `school-nav.ts` | B |
| 3.4 | Roadmap lists all five unbuilt flags | Transport, Library, Hostel, LMS (two entries), Events | B |
| 3.5 | Roadmap marks items whose module flag already exists | "Switch exists: …" badge | B |
| 3.6 | Every Features route under *Where it lives* resolves | no 404; no invented route | B |
| 3.7 | Chat, web push, campus calendar, discount repricing | on **Features**, not Roadmap — all four shipped despite `SPRINTS.md` still planning them | B |

## 4. No dates, no timelines — the product owner's standing rule

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 4.1 | Roadmap page text scanned for `20\d\d`, `Sprint \d+`, `Q[1-4]` | **zero matches** | B (regex over `innerText`) |
| 4.2 | Roadmap entry copy | name, what it does, who it is for — no ordering claim, no "next" | B |
| 4.3 | Features page makes no delivery promise | no date anywhere | B |

## 5. Search

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 5.1 | Features, type `voucher` | narrows to 9 entries; fee, reports, search and role profiles | B |
| 5.2 | Hash after 5.1 | `#q=voucher` | B |
| 5.3 | Hard-load `…/features#q=voucher` | opens already filtered, box pre-filled | B |
| 5.4 | Search matches a capability line, not just a name | e.g. `bell schedule` finds Academics & Timetable | B |
| 5.5 | Search matches a role name | `coordinator` returns the Coordinator profile | B |
| 5.6 | Search matches a glossary term | `challan` reaches the fee entries | B |
| 5.7 | Nonsense query | empty state naming what was searched, with a clear action | B |
| 5.8 | Clear the box | full list returns; hash emptied | B |
| 5.9 | Typing does not push a history entry per keystroke | one Back leaves the page, not one per character (`replaceState`) | B |
| 5.10 | Same search on Roadmap | identical behaviour, same hash key | B |

## 6. Filters

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 6.1 | Pillar = Finance | only Finance features; other pillar headings gone | B |
| 6.2 | Pillar filter hash | `#pillar=finance` | B |
| 6.3 | Role = Teacher | 18 entries: the teaching screens plus the four the teacher reaches as own records (leave, payslips, performance, chat) | B |
| 6.4 | Role = Teacher excludes Fees, Accounting, Payroll admin, Platform | absent | B |
| 6.5 | Role = Accountant | Accounting and Fees present; Marks entry absent | B |
| 6.6 | Role filter hash | `#role=teacher` | B |
| 6.7 | Search + pillar + role together | all three narrow; hash carries all three | B |
| 6.8 | Roadmap has pillar filter and search | present — role filter absent **by design**: an unbuilt feature has no role access to filter on | B |
| 6.9 | Filter to nothing | empty state, not a blank page | B |

## 7. Glossary

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 7.1 | Desktop (≥ `lg`) | glossary docked as a right rail, visible without scrolling to it | B |
| 7.2 | Below `lg` | floating **Glossary** button; opens a bottom sheet | B |
| 7.3 | Sheet closes | button, backdrop and `Esc` all close it | B |
| 7.4 | Click a term chip on a feature | glossary scrolls to that term and highlights it | B |
| 7.5 | Terms are categorised | Pillar, Module, Role, Platform, GoHighLevel | B |
| 7.6 | GHL terms are accurate | GHL is **opt-in per school**, contact sync only, nothing sends messages through it | B |
| 7.7 | Same glossary on both tabs | one list, not two copies | A (one component) |

## 8. Anchors and quick nav

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 8.1 | Quick-nav chips | one per pillar, plus Roles on Features | B |
| 8.2 | Click a pillar chip | scrolls to that pillar | B |
| 8.3 | Clicking a chip does **not** clear the filters | filters survive — the reason the nav scrolls instead of setting the hash | B |
| 8.4 | Every feature and role has an `id` | deep link lands | B |
| 8.5 | Hand-typed `#accounting` deep link | lands on the section; the hash writer leaves a non-filter hash alone | B |
| 8.6 | Any feature reachable in 1–2 clicks | chip → section, or search → entry | B |

## 9. Rendering and copy

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 9.1 | Backticked identifiers in capability and limitation lines | render as **inline code**, never as literal `` ` `` characters | B |
| 9.2 | An unbalanced backtick in copy | trailing fragment stays prose; the sentence is not swallowed | A |
| 9.3 | Each feature carries both registers | a factual `summary` and a `salesLine` a prospect would hear | B |
| 9.4 | Reads as sales copy | a pillar can be walked through top to bottom without explaining the codebase | B |

## 10. Design system, responsiveness, performance

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 10.1 | No hardcoded colour | no `bg-white`, no `text-slate-*` — platform tokens only | A (grep) |
| 10.2 | Not painted in a school's palette | platform `surface` / `ink` / `line`, like the rest of Super Admin | B |
| 10.3 | 375 px wide | `scrollWidth === clientWidth`; no horizontal page scroll | B |
| 10.4 | 375 px | filters stack, quick-nav chips wrap, glossary becomes a sheet | B |
| 10.5 | Console on both tabs | **zero** errors and zero hydration warnings | B |
| 10.6 | Network on both tabs | **zero** `/api/…` calls — the catalogue is in the bundle | B |
| 10.7 | First load JS | ~146 kB, below `/super-admin/feedback`'s 173 kB | A (build) |
| 10.8 | Second tab after the first | ~0.1 kB — the two share their chunks | A (build) |
| 10.9 | Neither segment has a `loading.tsx` | `check-loaders` passes in both directions | A |
| 10.10 | Both route files are committed | `check-loaders` fails them otherwise | A |

---

## What this sprint deliberately does not test

- **Tenancy isolation** — neither page reads a tenant. There is no school to
  leak and no `location_id` in the query path, because there is no query.
- **The permission matrix as an authorisation surface** — the Features tab
  *displays* `DEFAULT_ROLE_PERMISSIONS`; it does not enforce anything. The
  enforcement cases belong to the sprints that own those routes.
- **Print output** — neither tab is a print surface.

## Known and accepted

1. **Both pages are served dynamically**, not prerendered, because
   `app/(super-admin)/layout.tsx` is `force-dynamic`. Their own server render
   does no work; the cost is the layout's session read, which every Super Admin
   page already pays. The docblocks say so. Do **not** add a `loading.tsx` to
   "fix" it — `check-loaders` reads the page file and would fail.
2. **Roadmap has no role filter.** An unbuilt feature has no role access, so
   the control would do nothing. Each entry carries *who it is for* in prose
   instead.
