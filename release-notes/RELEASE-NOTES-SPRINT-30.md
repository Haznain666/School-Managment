# Sprint 30 — the desk that reached nobody, and the campus the header never named

**Branch:** `claude/lgs-school-portal-users-4042d5`
**Migration:** none. **`0045` is still the next free migration number.**
**Data step:** `scripts/apply-sprint30-data.mjs --apply` — **applied**
**Merged:** `dc588cd` (PR #71) · **live on build `dc588cda9380`**, CDN purged

---

## What this sprint is

Eight requirements from the product owner, all against Lahore Grammar, and two
of them turned out to be the same defect seen from opposite ends: **a parent
could write to four office desks that reached nobody, and could write by name to
the one person those desks exist to protect from being written to by name.**

The most useful single piece of evidence took one query, exactly as Sprint 29's
did: at Lahore Grammar, the only person in any of Father 1's children's
timetables was **Sumera Hasnain — the school administrator**. That is why she
appeared in the parent's dropdown as *"Teaches Pre-Nursery A"*, and it is why
three of the four desks routed to her as well.

---

## 1. Messaging is a module the platform sells, at the route and not only on the screen

`chat` has been in `PLATFORM_MODULES` since the catalogue existed, and Sprint 26
made the flag real on all four portals — the navigation entry and the page.
Nothing behind them asked.

So the flag hid the door and left the corridor open: a tab left over from before
a school's module was switched off kept working, and so did anything typed into
the address bar.

`withSchoolAuth` now takes a `module` gate, and **twenty chat routes carry it**.
A school without the module gets `403 — This module is not switched on for your
school`, after the role check, so a caller who may not do this at all is told
that rather than which product their school has not bought.

Three routes deliberately stay open: `signals`, `realtime-config` and
`push-subscription`. They carry no content, and `ChatStreamProvider` is mounted
in every portal layout on purpose — Sprint 29's note explains why gating the
transport would mean the flag being switched **on** did not take effect until
every open tab was reloaded.

**Proved live** by switching Askari's `chat` row off, watching three endpoints
answer 403, switching it back on and watching them answer 200.

## 2. The campus is in the header on every portal but the administrator's

Lahore Grammar runs Defence and Karachi. Every screen in every portal said
"Lahore Grammar School" and nothing else, so a teacher, a parent and a head all
read a page whose numbers are their campus's under a title that claims the whole
school.

`lib/branch-header.ts` decides it once for all four portals:

* **nothing at a single-campus school** — a label that never varies is furniture;
* **nothing for an account whose scope is the whole school.** This is the
  "except School Admin" in the requirement, and it falls out of the data rather
  than being a special case: an unscoped account has no campus to name.
* staff carry `school_users.branch_id`; **a pupil and a parent do not** — nothing
  on the enrolment path writes it — so theirs comes from the enrolment that
  decides everything else about them, section → grade → branch.
* a parent whose children sit at two campuses gets **no** label, for the same
  reason the administrator does not.

Verified on all four: parent, principal, teacher and pupil read
*"Defence Branch · <portal>"*; the school administrator reads the school name
alone, beside the All-campuses selector that makes it true.

## 3. A communication dated now goes out now

The clerk who sets *Send at* to this morning has said when they want it to go,
and the product then showed them a **Send now** button and waited to be told a
second time.

`listDueAnnouncements` reads *due at or before now*, so the sweeper released it
within sixty seconds anyway — which is the point: the button was never a second
authorisation, it was a minute of doubt about whether anything had happened.

A "send at" that has **already passed** is now dispatched inside the same
request, and the composer reports what it reached in the same words the manual
send uses. A time later today is still scheduled and the sweeper still owns it:
treating "today" as "now" would send a six o'clock notice at nine in the morning,
which is a different instruction from the one given.

## 4. Everything incoming rings the bell

Announcements were fixed in Sprint 27, chat in Sprint 29, feedback earlier still.
The gap left was **the desk** — and it rang nothing because there was nobody to
ring. See below; it is fixed by (6) rather than by a new writer.

## 5. Every grade has a class in it

A grade with no section is a rung nobody can be enrolled into: a child is placed
in a *section*, the timetable is built per section, and the class teacher hangs
off one. Seeding a ladder created sixteen grades and no classes, and the second
step was undocumented — so the enrolment wizard's section dropdown was empty at
a school that had done everything the screen asked of it.

**Section A, capacity 35** is now created:

* with a seeded ladder (`POST /api/school/grades`),
* on the year an academic-year run makes **active**, so a school rolling into
  2027-28 does not meet the same dead end annually,
* and for the estate that already exists, by the data step — **9 grades at
  Askari**, none at Lahore Grammar, Beacon House skipped for having no active
  year.

A grade that already has *any* section is left alone: a school running "Blue" and
"Green" has answered this question.

**The section chips are now buttons.** Clicking one opens a dialog with the name
and the capacity. Before this the only edits available to a class that already
existed were its class teacher and deleting it — and deletion is refused once a
single child is enrolled, which is exactly when a school discovers the capacity
is wrong.

## 6. Desk threads reach the staff who answer them

Two faults, and the second is the one nobody could see.

**Every desk listed `school_admin` first.** At a school that has not appointed an
accountant, a coordinator or a head of admissions — which is every school on the
platform today — all four desks landed on one person. `school_admin` is now the
**fallback** (`DESK_FALLBACK_ROLE`), seated only when nobody in the desk's own
`answeredBy` exists at that campus. A school admin may still *claim* any desk:
being copied on every enquiry by default was the defect; being able to pick one
up never was.

**A desk thread had no staff participant at all.** `listInbox` reads through
participant rows, so an enquiry to the Accounts Office appeared in **no** member
of staff's inbox, moved no badge, rang no bell, and waited for somebody to call
`POST …/claim` with an id nothing displayed. Four desks on the parent's dropdown
reached nobody.

The answerers are now **seated when the thread opens**, which is what makes the
inbox, the unread dot, the sidebar badge, the bell entry, the chime and the
hourly digest work on a desk thread — with no new plumbing, because all six
already work for a direct one.

`POST …/claim` had existed since Sprint 24 with **no caller anywhere in the
product** — the same shape as Sprint 27's orphaned holiday notice. It has a
button now: *Claim this enquiry*, offered only for a desk this reader's role can
actually claim, and everybody seated sees *"Claimed by …"* once somebody has.

**And a desk with nobody on it is no longer offered.** The product owner's rule,
in their words: *if the claiming staff is not created, appointed, or has been
removed from the system, do not give the option of starting a message with that
role.*

## 7. A desk thread is titled by its desk

A parent who wrote to the Principal Office saw **"The school"** — the fallback
for a thread with nobody else in it. Seating the answerers would have replaced
that with a clerk's personal name, which is worse: the whole point of writing to
a desk is that you are not writing to a named person, and the name that answers
today is not the one that answers in March.

Both sides now read *Principal Office*, *School Office*, *Accounts Office*,
*Admissions*. Who wrote each message is in the transcript, where it belongs.

## 8. A parent reaches their children's teachers, and only teachers

The timetable was already the gate — a teacher who stops teaching a section stops
being reachable by that section's parents the moment the grid says so. But it
gates on *who is in the grid*, and `timetable_entries.teacher_id` is any
`school_users` row.

Both halves — the subject teachers and the class teacher — now require
`school_users.role = 'teacher'`, on top of being active, in the current academic
year, and against the child's own section.

> ⚠ **A consequence Lahore Grammar should know about.** With this in place,
> Father 1 can currently reach **no teacher at all**, because the only person in
> any of his children's timetables is the school administrator. That is the rule
> working as specified, and the fix is at the school's end: put teachers on the
> Pre-Nursery, Nursery, Prep and Year 2 timetables. Askari, where real teachers
> are timetabled, correctly offers three.

---

## Evidence

### `npm run check-sprint30` — 29 ok, 0 failed or not exercised

There is **no migration**, so there is no predicted `42P01` / `42703` to hide
behind: every statement must execute, and a failure is a real defect.

It exists mainly for one statement. `listInbox` already joined four tables and
aggregated `school_users.name`; this sprint adds a **second `school_users`** —
the person holding a desk thread — so `name` now appears three times in one
query. It is joined through `alias()` rather than a `sql` template, which is the
distinction `CLAUDE.md` draws after Sprint 18 paid 42702 for the other one. Only
Postgres resolves a name, so it is run and not read.

Trap 2 is honoured twice, because a statement that matched no row planned and
proved nothing:

* the default-section **insert** is proved by writing against a real grade in a
  real year inside a transaction that is always rolled back, twice — the second
  attempt must add nothing;
* the teacher filter is proved against **five real parents**, requiring that
  every person any of them can reach is a teacher.

### Green build

typecheck · lint · check-loaders · check-forms · check-address-phone ·
check-cnic · check-currency · check-theme · check-sprint-periods ·
check-accounting · check-branch-scope · build — plus check-portals,
check-dashboard, check-sprint24, check-sprint28 and check-sprint29.

### Driven on the live build

Signed in with `scripts/qa-emergency-link.mjs`, which is the way into a QA
session and needs nobody's password.

| Checked | Result |
| --- | --- |
| Parent, LGS | Header *Defence Branch · Parent Portal*; three desk threads titled **School Office / Principal Office**; dropdown offers four desks and **no** administrator |
| Parent, Askari | Three real teachers — two from the timetable, one class teacher — beside the four desks |
| Principal, LGS | **Messages badge 2**; both *Principal Office* enquiries in the inbox; **Claim this enquiry** → claimed, the row stopped offering it |
| Branch admin, LGS | Claimed and answered an office enquiry unprompted during QA — the first time any desk thread has reached a member of staff |
| Bell | That reply wrote one `chat_message` entry to `/dashboard/chat` for the other seated administrator and one to `/parent/chat` for the parent |
| School admin, LGS | Header carries **no** campus, as specified |
| Teacher & pupil, LGS | *Defence Branch · Teacher Portal* / *· Student Portal* |
| Askari (one campus) | No campus label anywhere — correct |
| Grades, Askari | Class 1–4 and 6–10 show **A · 0/35**; chip opens the dialog; capacity 40 saved and reloaded, then restored to 35 |
| Communications, Askari | A notice dated five minutes ago saved as **Sent**, composer reported *"Sent — on the notice board for 1 person"*, no Send now button. Row deleted afterwards |
| Module gate, Askari | `chat` off → three endpoints 403 with the module message; on → 200. Restored |

Everything QA wrote was removed: the announcement and its recipient and bell
rows, the capacity change, and the claim.

**Not opened:** the Super Admin module screen itself, which needs the platform
operator's own password. The per-school toggle grid is generated from
`PLATFORM_MODULES` and `chat` is asserted to be in it; what this sprint adds —
the route honouring the flag — was proved by flipping the flag.

---

## The data step

`node scripts/apply-sprint30-data.mjs` reads and changes nothing; `--apply`
writes. Idempotent, and a second run reports nothing to do.

1. **Section A (35)** for every grade with no section in its school's active
   year — 9 at Askari.
2. **Staff seats** on desk threads opened before this sprint — 3 at Lahore
   Grammar, seated to the two campus administrators and the principal, and to
   the school administrator nowhere.

Both reversible: delete the sections while nothing is enrolled in them, delete
the `chat_participants` rows the script prints.
