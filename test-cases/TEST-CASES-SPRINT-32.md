# Test cases — Sprint 32: staff KPIs and performance

Requirement: STATE.md §5ca. Tenant used for QA: **Askari School System**
(`askari-school-system`, `principal_model = multiple`, two campuses, five
principals, two branch admins, two vice principals, two coordinators).

**Every browser case is run on a hard-loaded page** — type the URL, then act.
A test that clicks its way there passes the stale-list defect this sprint fixes.

Legend: **A** = automated (`check-sprint32` / `verify-0045`), **B** = browser.

## 1. Module and permissions

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 1.1 | School without `staff_kpis` opens `/dashboard/performance` | "not enabled" card; no sidebar section | B |
| 1.2 | Same school calls `GET /api/school/kpis` | 403 "This module is not switched on" | B |
| 1.3 | Super Admin toggles the module on | saves (no 23514) | A (`verify-0045`) |
| 1.4 | School overrides `kpis.rate.vice_principal` in the matrix | saves (no 23514) | A |
| 1.5 | Defaults: Branch Admin lacks `kpis.rate.teacher`; VP lacks `kpis.rate.vice_principal`; Accountant holds only `kpis.overall` | as stated | A |
| 1.6 | Permissions screen shows a "Staff performance" group with 10 rows | visible | B |

## 2. Defining KPIs (rule 3)

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 2.1 | School Admin opens KPIs, role dropdown | all 8 roles | B |
| 2.2 | School Admin adds *Punctuality*, Teacher, Monthly | appears in the list **without a reload** | B |
| 2.3 | Principal's role dropdown | no Principal, no Branch Admin | B / A |
| 2.4 | VP's role dropdown | no Principal, Branch Admin or Vice Principal | A |
| 2.5 | Principal POSTs a KPI for `branch_admin` directly | 403 | B (fetch) |
| 2.6 | Coordinator opens KPIs | no Add button, no Edit/Delete | B |
| 2.7 | Edit name of a rated KPI | saves | B |
| 2.8 | Change period of a rated KPI | 409 "Create a new KPI instead" | B (fetch) |
| 2.9 | Delete a KPI | gone from list without reload; ratings kept in history as "Deleted KPI" | B |
| 2.10 | Empty name | inline error, nothing sent | B |

## 3. Rating (rules 4, 5, 7a, 7b, 7c, 8)

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 3.1 | Principal rates own teacher Punctuality 10 + comment | saved; counting score 10/10 shows immediately; monthly overall 100% | B |
| 3.2 | Principal rates another principal's teacher via API | 403 naming the other principal | B (fetch) |
| 3.3 | Coordinator rates an unassigned teacher via API | 403 "not one of the teachers assigned to you" | B (fetch) |
| 3.4 | Coordinator rates an assigned teacher 9, principal already rated 7 | coordinator's row kept in history, **7 counts** (Principal) | B |
| 3.5 | Rater changes 6 → 8 | history shows both; 8 counts; UPDATE never used | B / A (trigger P0001) |
| 3.6 | Score 11 / 0 / 7.5 via API | 400 | B (fetch) |
| 3.7 | Rate a future month | 400 | B (fetch) |
| 3.8 | Branch Admin rates a teacher | 403 (no key) | B (fetch) |
| 3.9 | VP rates a VP | 403 "never rates a Vice Principal" | A (rule) |
| 3.10 | Anybody rates themselves (not allowed by setting) | 403 "cannot rate yourself" | B (fetch) |
| 3.11 | Principals' setting off; School Admin rates a principal | 403 naming the setting | B (fetch) |
| 3.12 | Setting on with School Admin; School Admin rates a principal | 201 | B |
| 3.13 | Several principals, no Branch Admin on the campus; principal rates an accountant | 403 | A (rule) |
| 3.14 | Rating after a transfer, from the old principal's stale tab | 403 on the write | B (fetch) |

## 4. One teacher, one principal (rule 7b)

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 4.1 | Most periods under one principal | derived to them | A |
| 4.2 | Tie; class-teacher section under one of them | that one | A |
| 4.3 | Tie with no class-teacher tie-break | Unassigned, candidates listed; School Admin sets it | A / B |
| 4.4 | No periods, no class | Unassigned, named on Setup | A / B |
| 4.5 | Second current row for a teacher | refused 23505 | A |
| 4.6 | Principal requests a transfer of their teacher | request listed, other principal sees Accept/Decline | B |
| 4.7 | Other principal accepts | teacher moves; source "Transferred"; not undone by reload | B |
| 4.8 | Requester tries to accept own request | 403 | B (fetch) |
| 4.9 | Two accepts at once | one 200, one 409 | code review (conditional UPDATE) |

## 5. Visibility (rules 8, 9, 10)

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 5.1 | Accountant opens Overview | yearly column only, no names linked, no monthly column | B |
| 5.2 | Accountant GETs a person sheet | `visibility: overall`, no KPIs, no history, no comments | B (fetch) |
| 5.3 | HR opens Overview | every campus's staff, full | B |
| 5.4 | Coordinator opens a supervised teacher | KPIs, history, *About* panel with timetable/register/leave/lesson plans; **no salary, bank, CNIC** | B |
| 5.5 | Teacher opens `/teacher/performance` | own scores and comments, no rate controls | B |
| 5.6 | Teacher GETs another person's sheet | 404 | B (fetch) |
| 5.7 | School Admin opens My performance | "Your role is not rated" | B |

## 6. Stale lists after a save (§5ca bug fix)

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 6.1 | Hard-load `/dashboard/communications`, save a draft | draft in list within a second, no reload | B |
| 6.2 | Send it | status becomes Sent without reload | B |
| 6.3 | Discard a draft | row disappears without reload | B |
| 6.4 | Hard-load `/teacher/chat` (desktop and 430px), start a new conversation | appears in list and opens | B |
| 6.5 | KPI save and rating save on hard-loaded pages | appear without reload | B (2.2, 3.1) |

## 7. Loaders and phone width

| # | Case | Expected | How |
| --- | --- | --- | --- |
| 7.1 | Every new page has a loader of the right shape | `check-loaders` passes | A |
| 7.2 | Month change on the board / sheet | table dims with "Loading…" | B |
| 7.3 | Board and sheet at 430px | no horizontal page scroll; table scrolls in its card | B |
