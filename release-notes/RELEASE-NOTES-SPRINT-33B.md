# Release notes — Sprint 33b: the Section Head, the chain of command and HR leave

**Date:** 17 September 2026
**Part B of three.** Part A (the three defects, the campus gap and the two
notification faults) is already live. Part C — the portal work — follows.
**Migrations:** `0047` and `0048`, with a data step between them. The order
matters; see **Deployment**.

## New

### Section Head is a role
A school can now appoint Section Heads. A Section Head signs in to the
administrative portal, sees the sections they run, and approves leave for the
coordinators under them and for everyone under those coordinators.

Where they sit: **Principal → Vice Principal → Section Head → Coordinator →
Teacher**, with Branch Admin ranking alongside the Vice Principal and heading
every non-teaching role.

- In chat, a Section Head ranks above a Coordinator and below a Branch Admin.
  They can be given a chat grant, and they **cannot ban a named person** — that
  stays with the four roles that already had it.
- Section Heads appear on the Principal's performance board and can be rated
  like any other member of staff.
- The role is invitable, so HR can invite one directly rather than creating an
  account and changing it afterwards.

### One Principal and one Vice Principal per campus
Divisions inside a campus are retired. A campus has **one** Principal and
**one** Vice Principal, and the database now refuses a second: inviting,
creating or promoting somebody into a seat that is taken comes back with a
readable sentence **naming the person already in it**, rather than a constraint
error.

**Nothing was deleted to make this true.** A school that already had more than
one gets a report on the reporting-line screen, and the extra people are moved
by hand. At Askari, Imran Qureshi remains Principal of Main Campus, and Farah
Siddiqui, Rukhsana Bano and Tariq Jameel became Section Heads — which is what
the new role is for.

### The chain of command, on a screen
`HR → Reporting line` shows, per campus, who reports to whom and who will
decide a given person's leave. It is also where Section Heads are given their
coordinators.

Two rules are built in, because both are ordinary rather than exceptional:

- **A missing level is skipped.** A campus with no Section Head routes a
  coordinator's request straight to the Vice Principal. Nothing has to be filled
  in for leave to work.
- **A teacher supervised by more than one coordinator goes to the Vice Principal
  and above.** With two supervisors there is no single answer to "who decides",
  so the chain does not guess.

### Leave, end to end
Every member of staff with a login now applies for their own leave — teachers
from `Teacher → Leave`, everyone else from `Leave → My leave`. The form shows
the entitlement, what is left, and **the chain the request will travel**, in
words, before it is sent.

Approvers get `Leave → Approvals`: the requests that are genuinely theirs to
decide, with the chain shown on each one.

What a request is refused for, and why:

| Situation | What happens |
| --- | --- |
| A **single day** on a gazetted holiday | Refused, naming the holiday. The school is already closed. |
| A **range** whose first or last day is a holiday | Accepted. Whether the holiday is counted is the campus setting below. |
| A day already covered by other leave | Refused, naming the existing range. |
| More days than the entitlement leaves | Refused, with the arithmetic in the sentence. |
| Somebody outside the chain trying to decide | Refused, naming who the approvers actually are. |
| An approver at another campus | Refused. |

**Holidays inside a leave span** are a setting HR makes, per campus: *skip the
holiday from the span* or *include it*. Whatever HR chooses applies to everybody
at that campus.

**Entitlement is pro-rated** from the date a person became permanent, against
the school's own academic year, and **lapses at year end** — there is no carry
forward.

### Two staff calendars, and overrides
A campus keeps a **teaching** and a **non-teaching** staff calendar. Gazetted
holidays appear on both automatically.

HR can override one holiday on one calendar — cancel it or move it — choose
**which roles it applies to**, and optionally notify them. The notification is
the announcement the holiday screen already sends; there is no second inbox to
check. *Summer off for teaching staff only* is now expressible: a holiday on the
teaching calendar.

### Probation
The HR staff form carries probation for full-time staff: the start, the length
in days, an **extension**, and the end date computed as you type.

**180 calendar days is the ceiling, holidays included** — and an extension
counts toward it, so 120 days plus a 61-day extension is refused for the same
reason 181 days is. HR is emailed when a probation period ends — the School Administrators
if the school has no HR manager.

Leave entitlement accrues only from the date a person becomes permanent, which
is what the end of probation sets.

## Changed

### Leave has its own permissions
One HR key used to cover everything. There are now four, and they appear in the
**Permissions** section like every other approval right:

| Key | Grants |
| --- | --- |
| `leave.read` | see leave, within your scope |
| `leave.request` | apply for your own |
| `leave.approve` | decide a request from someone below you |
| `leave.manage` | leave types, quotas, the staff calendars, the holiday setting |

The existing HR keys keep working. The defaults give every approving role
`leave.approve`, every staff role `leave.request`, and HR `leave.manage` — so a
school that changes nothing sees the behaviour it expects.

**Leave types are now editable from the screen**: create, rename, change the
annual quota and whether it is paid, and retire one that is no longer offered.
Retiring keeps the leave already taken against it.

### The old HR leave endpoints are closed
`POST /api/school/hr/leave-requests` and
`PATCH /api/school/hr/leave-requests/[id]` now answer **410**, pointing at
`/api/school/leave/requests`. They wrote leave without the chain, without the
campus check and without the holiday, overlap and quota refusals — a door around
every rule above. `HR → Leave` files and lists through the new route, and **HR
no longer decides**: filing a request and approving it are different jobs, held
by different people.

Anything integrating against those two endpoints needs to move. Nothing in the
product still calls them.

## Deployment

**In this order, and not with `npm run db:migrate`:**

1. `db/migrations/0047_sprint33b_section_head_leave.sql`
2. the code
3. `node scripts/apply-sprint33b-data.mjs --apply` — only for a school that has
   more than one Principal or Vice Principal on a campus
4. `db/migrations/0048_sprint33b_one_head_per_campus.sql`

The order is not a preference. The role check has to widen before an account can
be a Section Head; the code has to recognise the role before those people sign
in; and the uniqueness rule can only be created once no campus has two.

- **`0047`** rewrites **six** CHECK constraints — `school_users`,
  `school_invitations`, `role_permissions` (role *and* permission),
  `saturday_duty_policies` and `staff_kpis` — adds **seven** columns to `staff`,
  and creates four tables: `section_head_coordinators`, `staff_calendars`,
  `staff_calendar_overrides` and `branch_leave_settings`. Every added column is
  nullable or has a constant default, so no table is rewritten and no long lock
  is taken.
- **`0048`** counts the duplicates **first** and refuses to run while any
  remain, naming them. It then creates four partial unique indexes. It never
  deletes a person.

No configuration is needed. The four new permission keys arrive with defaults,
so the permission matrix only needs attention at a school that wants to change
them.

## Not in this part

- The parent timetable, the paid-voucher receipt, the chat recipient picker and
  teacher availability with quick substitutes — Part C.
- Payroll's disagreement with the KPI resolver, and the 35 stale-list screens.
  Both are out of scope for this round by decision.
