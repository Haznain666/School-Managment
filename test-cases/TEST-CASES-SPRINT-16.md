# Test cases — Sprint 16: school feedback, global search, and the dashboard fixes

Traces to [`RELEASE-NOTES-SPRINT-16.md`](../release-notes/RELEASE-NOTES-SPRINT-16.md).
Migration `0032` — **APPLIED and verified** against the live database on
2026-08-26. The sprint is **deployed and live as `47e072c1f058`**
(PR [#32](https://github.com/Haznain666/School-Managment/pull/32)); the cache
purge and the commit confirmation both ran green, and the three new platform
endpoints answer **401** on the live host rather than 404.

## Status — 2026-08-26

| Mark | Meaning |
| --- | --- |
| ✅ | executed and passing |
| 🔁 | **was a defect, now fixed and re-verified** |
| ⚠️ | executed, passed, with a caveat recorded |
| ⬜ | not executed, and why |

**How this sprint was verified.** All fourteen gates on the final tree, then a
run against a **production standalone build** (`node --env-file … server.js`),
signed in as the platform Super Admin and then into *Lahore Grammar School*
through *Login as Admin*, against the live database — 9 enrolled students, 15
sections, 5 subjects, 1 staff record.

⚠️ **The browser pane in this environment does not paint streamed content.** It
serves the request, the server produces the complete HTML, and the trailing
inline scripts that splice a resolved Suspense boundary into the page never run
— so a route with a `loading.tsx` shows its skeleton forever. **This was proved
to be environmental and pre-existing**: `/super-admin/modules`, a page this
sprint does not touch, behaves identically. Screenshots are unavailable for the
same reason (§5bc recorded the same).

So the screens below were verified by **fetching the server HTML from inside the
page and parsing it**, and every behaviour by **driving the real endpoints with
the real session cookie**. Where a screen did paint — the school-admin dashboard
and the platform dashboard both did — it was also measured live in the DOM. Each
case says which.

**Five defects found and fixed** — F1 to F5 below.

---

## 1. Sending feedback — the school side

| ID | Case | Result |
| --- | --- | --- |
| UC-S16-01 | **Feedback** appears in the school-admin sidebar for every administrative role, gated on no permission | ✅ live DOM |
| UC-S16-02 | `/dashboard/feedback` lists this school's own tickets, newest first, with Nature, Status, Replies and Sent columns | ✅ server HTML |
| UC-S16-03 | The empty state reads "No feedback yet" and offers **Send feedback** | ✅ server HTML |
| UC-S16-04 | `/dashboard/feedback/new` renders Title, a Bug/Suggestion select, Description and an attachment picker | ✅ server HTML |
| UC-S16-05 | The nature select **defaults to Suggestion** | ✅ server HTML, and asserted server-side: a POST naming no nature stores `suggestion` |
| UC-S16-06 | The form states the limits: "Up to 5 PNG, JPEG or PDF files, 10 MB each" | ✅ server HTML |
| UC-S16-07 | A ticket with a **PNG and a PDF** attached is accepted, `201`, and stores both | ✅ live — 70-byte PNG and 192-byte PDF round-tripped byte-exact |
| UC-S16-08 | A **sixth** attachment is refused, `400 too_many_attachments`, "Attach at most 5 files." | ✅ live |
| UC-S16-09 | A `.exe` is refused, `415 unsupported_attachment`, naming the file | ✅ live |
| UC-S16-10 | A blank title is refused, `400`, "Give the feedback a title." | ✅ live |
| UC-S16-11 | A blank description is refused with its own message | ✅ code path shared with UC-S16-10; not separately driven |
| UC-S16-12 | A file over 10 MB is refused with its size named | ⬜ not driven — the browser-side check fires first and the server rule is the same constant |
| UC-S16-13 | Choosing a second file **adds** to the selection rather than replacing it | ⬜ needs a painted page; the accumulate-in-state logic is in `FeedbackForm` |
| UC-S16-14 | Files can be removed individually before sending | ⬜ same |

---

## 2. What the Super Admin receives

| ID | Case | Result |
| --- | --- | --- |
| UC-S16-15 | Sending feedback writes a **`super_admin` in-app notification** naming the nature, the title and the school | ✅ live — *"Bug: Timetable grid shows periods the class cannot sit / Lahore Grammar School"* |
| UC-S16-16 | It also **queues an email** to the platform owner (`SUPER_ADMIN_EMAIL`) | ✅ live — subject *"New bug report from Lahore Grammar School"*, and the outbox shows `sent`, 1 attempt |
| UC-S16-17 | The email body carries title, nature, sender and attachment count | ✅ live, read out of `email_outbox` |
| UC-S16-18 | The bell badge shows the unread count and clears when the panel is opened | ✅ live — `unread: 1` → `POST` marked 2 → `unread: 0` |
| UC-S16-19 | The platform dashboard has a **New feedback** tile counting unread only | ✅ live DOM |
| UC-S16-20 | The dashboard chip reads "Feedback (n new)" when something is unread | ✅ code; the live tenant was at zero when the dashboard was last painted |

---

## 3. The platform queue

| ID | Case | Result |
| --- | --- | --- |
| UC-S16-21 | `/super-admin/feedback` renders four sections: Active, Work in progress, Future development, Resolved | ✅ server HTML |
| UC-S16-22 | Default status on arrival is **Unread** | ✅ live |
| UC-S16-23 | Rows read **"Title — School name"** | ✅ server HTML |
| UC-S16-24 | A bug row carries a red left edge **and** a "Bug" badge — colour is never the only carrier | ✅ code + server HTML |
| UC-S16-25 | Opening a ticket flips **Unread → Read** and the unread count drops | ✅ live — counts `unread: 1` → `unread: 0`, `active` unchanged at 2 |
| UC-S16-26 | A **read** ticket stays in **Active**: reading is not deciding | ✅ live |
| UC-S16-27 | The counter toggle shows a count beside each section title, and is **off by default** | ✅ server HTML (`Show counters` present, no counts rendered) |
| UC-S16-28 | The counters are whole-estate figures, not narrowed by the search box | ✅ code — the route always returns unfiltered counts |
| UC-S16-29 | Filters offer Nature and School; search covers title, body, sender and school name | ✅ server HTML + live API |
| UC-S16-30 | Sorting is offered from Feedback, Nature, Status, School and Received | ✅ code — whitelisted in `FEEDBACK_SORT_COLUMNS`, enforced by `readListQuery` |
| UC-S16-31 | Pagination offers 25/50/100 and caps at 100 server-side | ✅ server HTML + `readListQuery` |
| UC-S16-32 | Status can be set **from the listing** as well as the detail page | ✅ code; the control is a `<select>` per row |
| UC-S16-33 | Setting a status moves the ticket to that section and the counts follow | ✅ live — `active: 2 → 1`, `in_progress: 0 → 1` |
| UC-S16-34 | Setting the **same** status again is a no-op: `changed: false`, and **no second notification** | ✅ live |
| UC-S16-35 | `unread` and `read` cannot be set through the API — `400`, "Choose Work in progress, Future development or Resolved." | ✅ live |
| UC-S16-36 | An empty section reads "Nothing under *Active*" and explains what would arrive | ✅ 🔁 server HTML — see F3 |

---

## 4. The conversation, and what it notifies

| ID | Case | Result |
| --- | --- | --- |
| UC-S16-37 | A status change writes a **`school_user` notification** to the person who sent it | ✅ live — *"Your feedback is now Work in progress"* |
| UC-S16-38 | …and emails them | ✅ live — *"Work in progress: Add a bulk fee-concession import"*, `sent` |
| UC-S16-39 | A **Super Admin reply** notifies and emails the school | ✅ live — *"Re: Add a bulk fee-concession import"*, `sent` |
| UC-S16-40 | The reply is signed **"SMS Platform Support"**, never an operator's own address | ✅ code |
| UC-S16-41 | A **school reply** notifies the platform | ✅ live — platform bell shows *"Reply on …"* |
| UC-S16-42 | An empty reply is refused, `400`, "Write a reply first." | ✅ live, both sides |
| UC-S16-43 | The school's detail page shows the platform's reply and the current status | ✅ live — server HTML contains both |
| UC-S16-44 | A ticket whose sender's account has been deleted still shows their name | ✅ by construction — the name and address are snapshotted on the row (`ON DELETE SET NULL`) |

---

## 5. Attachments, and who may read them

| ID | Case | Result |
| --- | --- | --- |
| UC-S16-45 | Clicking an attachment **downloads** it — `Content-Disposition: attachment` | ✅ live, both routes |
| UC-S16-46 | The response carries the stored content type and `X-Content-Type-Options: nosniff` | ✅ live |
| UC-S16-47 | The response is `Cache-Control: private, no-store` — never cached at the CDN | ✅ live |
| UC-S16-48 | The original filename survives, in both the ASCII and the RFC 5987 form | ✅ live — `filename="screenshot.png"; filename*=UTF-8''screenshot.png` |
| UC-S16-49 | **No public URL is ever stored** — only the object path | ✅ code + schema |
| UC-S16-50 | Deleting a ticket removes its replies, its attachment rows **and** the stored objects | ✅ live — the download 404s afterwards |
| UC-S16-51 | Deleting a ticket that is already gone answers `404`, not `500` | ✅ live |
| UC-S16-52 | Deletion sends the school no notification | ✅ code — deliberate, and stated in the route |

---

## 6. Tenancy — **NEEDS TENANCY**, and it was available

Driven with two real schools on the live tenant, entering each through
*Login as Admin*.

| ID | Case | Result |
| --- | --- | --- |
| UC-S16-53 | School B's feedback list does not contain School A's ticket | ✅ live — Beacon House sees `[]` while LGS has one |
| UC-S16-54 | School B downloading School A's attachment gets **404** | ✅ live |
| UC-S16-55 | School B replying to School A's ticket gets **404** | ✅ live |
| UC-S16-56 | The 404 does not distinguish "not yours" from "does not exist" | ✅ code + live — one message for both |
| UC-S16-57 | Every school-side read takes its `locationId` from the verified session, never from the request | ✅ code — `getFeedbackTicket(id, locationId)` and `listSchoolFeedback(locationId)` cannot be called without it |
| UC-S16-58 | The platform routes are behind `requireSuperAdmin`, not `withSchoolAuth` | ✅ code |

---

## 7. Global search

| ID | Case | Result |
| --- | --- | --- |
| UC-S16-59 | A search box is in the header of all five portals | ✅ live (school admin, Super Admin), code (three portals) |
| UC-S16-60 | `/` and `Ctrl`/`⌘`+`K` focus it from anywhere | ✅ code; `/` is skipped while a field is focused |
| UC-S16-61 | Typing opens a dropdown of the best three hits per category | ✅ **live, driven by keyboard** — typing *class* returned *Teachers & staff → Ayesha Siddiqui* and three *Classes & sections* rows |
| UC-S16-62 | Every dropdown row names the screen it opens | ✅ live — *"Staff record"*, *"Classes & sections"* |
| UC-S16-63 | The dropdown is not clipped by its container and stays on screen | ✅ live — 448×309 at (262, 57), inside a 1280×720 viewport, `z-index: 1000` |
| UC-S16-64 | A query under two characters returns nothing and says "keep typing" rather than "no results" | ✅ live — `q=a` returns `total: 0` with the query echoed |
| UC-S16-65 | Enter opens the results page for the query | ⚠️ the router call fires; the destination did not paint in this pane (§ the streaming caveat). The page itself was verified by fetching it |
| UC-S16-66 | The results page groups by category with a count per group | ✅ server HTML — *"9 results across 2 categories"* |
| UC-S16-67 | A truncated group says so rather than dropping rows silently | ✅ server HTML — *"Showing the first 8. There are more."* |
| UC-S16-68 | Each group offers a link to its own full screen | ✅ server HTML — *"Open teachers & staff"* |
| UC-S16-69 | Every hit carries a subtitle that distinguishes it | ✅ live — *"QA14-T1 · Class Teacher"*, *"Defence Branch"* |
| UC-S16-70 | **Screens** is a category — searching *fee* returns the fee screens | ✅ live — 8 screen hits for *fee*, 3 for *students* |
| UC-S16-71 | The Screens category is built from the caller's own navigation, so it cannot name a screen they may not open | ✅ code — `searchPages` takes `schoolNav`'s output |
| UC-S16-72 | Each record category is gated on the read permission its destination enforces | ✅ code — `searchSchoolPortal` gates on `admissions.read`, `hr.read`, `users.read`, `academics.read`, `fees.read`, `comms.read` |
| UC-S16-73 | A principal's search is narrowed to their own grades | ✅ code — the same `resolveDashboardScope` the dashboard uses; asserted by `check-dashboard`'s scope cases |
| UC-S16-74 | A search for `100%` does not match every row | ✅ code — `likePattern` escapes `%`, `_` and `\` |
| UC-S16-75 | Super Admin search is cross-tenant and every hit names its school | ✅ code + server HTML |
| UC-S16-76 | The results page works with no JavaScript — a plain GET form | ✅ code — `<form method="get">` |
| UC-S16-77 | Teacher search reaches only their own sections | ⬜ **no teacher account exists on the live tenant.** The scope is one `inArray` over the sections `listTeacherSections` and `listClassTeacherSections` return; an empty list matches nothing |
| UC-S16-78 | Parent search reaches only their own children | ⬜ same — resolved through `listPortalChildren` |
| UC-S16-79 | Student search reaches only themselves | ⬜ same |
| UC-S16-80 | `/teacher/search`, `/parent/search`, `/student/search` refuse a caller holding the wrong role | ✅ live — all three redirect, none 500s |
| UC-S16-81 | A parent or student cannot find an unsent announcement | ✅ code — the portal search filters `status = 'sent'`; the administrative one does not |

---

## 8. The dashboard

| ID | Case | Result |
| --- | --- | --- |
| UC-S16-82 | **School setup** shows a progress bar and six entities with headcounts | ✅ live — *"5 of 6 in place… Progress 83%"* |
| UC-S16-83 | The percentage is stated in text beside the bar, and the bar carries `role="progressbar"` with its values | ✅ live DOM |
| UC-S16-84 | An outstanding step says "Not set up yet" in words as well as in colour, and links to the screen that fixes it | ✅ live — *"Not set up yet — Invite the head of the school so they can sign in."* |
| UC-S16-85 | A completed step keeps its count and drops its link | ✅ live |
| UC-S16-86 | Teachers counts staff records **and** teacher accounts | ✅ 🔁 live — see F1 |
| UC-S16-87 | Principal counts accounts, not `schools.principal_name` | ✅ live — 0 at LGS, which has a principal name on file and no principal account |
| UC-S16-88 | **Class strength** and **Recent exam outcomes** are the same width as the charts above them | ✅ 🔁 **live, measured**: both cards 479px with a 177px chart, identical to Collections, Attendance and Ageing. See F2 |
| UC-S16-89 | Quick links are at the **top** of the dashboard, as chips | ✅ live — 10 chips, `border-radius: 9999px`, 34px tall, 104px below the top of the content area |
| UC-S16-90 | Chips are permission-gated, not role-gated | ✅ code |
| UC-S16-91 | Quick-link chips are on the Super Admin, teacher, parent and student dashboards too | ✅ live (Super Admin), code (three portals) |
| UC-S16-92 | **One scrollbar** on a portal screen, not two | ✅ 🔁 **live, measured** on both the school-admin and the platform dashboard: root scrollbar 0px, root max scroll 0, content scrollbar 15px. Before the fix: root scrollbar 15px, root max scroll 465px. See F4 |
| UC-S16-93 | No horizontal overflow at 375px | ✅ live — `body.scrollWidth === documentElement.clientWidth` |
| UC-S16-94 | On a phone the header offers a search **link** where the box does not fit | ✅ live at 375×812 — box hidden, 36px link present, bell present |

---

## 9. Migration `0032`

**AUTOMATED** — re-runnable, and it was run.

| ID | Case | Result |
| --- | --- | --- |
| UC-S16-95 | Bookkeeping advanced from 32 rows to **33** | ✅ |
| UC-S16-96 | Four tables exist with exactly the expected columns (13 / 7 / 7 / 10) | ✅ |
| UC-S16-97 | Five CHECK constraints and seven foreign keys are present | ✅ |
| UC-S16-98 | Seven indexes are present | ✅ |
| UC-S16-99 | `nature` defaults to `suggestion`, `status` to `unread` | ✅ real insert, rolled back |
| UC-S16-100 | An invented status is **refused** by the database, not only by the route | ✅ savepoint test |
| UC-S16-101 | An invented nature is refused | ✅ savepoint test |
| UC-S16-102 | A `school_user` notification with no recipient is refused | ✅ savepoint test |
| UC-S16-103 | A `super_admin` notification with no recipient is **accepted** — the inverse is deliberately unconstrained | ✅ |
| UC-S16-104 | The verification left no rows behind | ✅ `count(*) = 0` afterwards |

---

## 10. The gates

**AUTOMATED** — run these, do not click them.

| ID | Case | Result |
| --- | --- | --- |
| UC-S16-105 | `npm run typecheck` | ✅ |
| UC-S16-106 | `npm run lint` | ✅ |
| UC-S16-107 | `npm run check-loaders` — 271 assertions | ✅ |
| UC-S16-108 | `npm run check-forms` — 60 | ✅ |
| UC-S16-109 | `npm run check-address-phone` — 40 | ✅ |
| UC-S16-110 | `npm run check-cnic` — 36 | ✅ |
| UC-S16-111 | `npm run check-sprint-periods` — 107 | ✅ |
| UC-S16-112 | `npm run check-accounting` — 121 | ✅ |
| UC-S16-113 | `npm run check-theme` — 7 palettes | ✅ |
| UC-S16-114 | `npm run check-dashboard` — **43** aggregates, up from 41: `getSetupProgress` is registered scoped and unscoped | ✅ |
| UC-S16-115 | `npm run check-portals` — 22 | ✅ |
| UC-S16-116 | `npm run check-reports` | ✅ |
| UC-S16-117 | `npm run check-provisioning` | ✅ |
| UC-S16-118 | `npm run check-smtp` | ✅ |
| UC-S16-119 | `npm run build` | ✅ |

Every new route carries a `loading.tsx` rendering a real skeleton shape, and
`check-loaders` enforces it in both directions.

---

## Defects found, and fixed

**F1 — "Teachers 0" at a school with a teacher on the register.**
The setup step counted `school_users` with the role `teacher`. Lahore Grammar
School has an active `staff` record for a class teacher and **zero** teacher
accounts — the person is on the HR register and has never been invited to the
portal — so the panel reported 0 and told the school to redo work it had done.
It now counts active staff records **plus** teacher accounts with no staff
record behind them, de-duplicated by the join, and the step is labelled
*Teachers & staff*. Re-verified: *"5 of 6 in place… Teachers & staff 1"*.

**F2 — the two charts the product owner reported.**
*Class strength* and *Recent exam outcomes* were full-width cards. Both charts
are a fixed 640-unit `viewBox` scaled to their container, so at ~977px they
rendered at roughly twice the height of the eight charts above them. Nothing
about the charts was wrong; they were the wrong width. Measured after the fix:
479px card, 177px chart — the same as Collections and Attendance.

**F3 — "All nature", "All school", "Nothing in active".**
`DataTable` defaults its no-choice filter option to `All <label>` lowercased.
Both listings now name their own: *Every nature*, *Every school*, *Any status* —
and the empty state reads *"Nothing under Active"*.

**F4 — two scrollbars on every portal screen.**
The one the product owner reported, and the cause is not what it looked like.
Measured at 1280×720 on the platform dashboard: `innerWidth −
documentElement.clientWidth` was **15** (a real root scrollbar) and
`documentElement.scrollHeight` was **1185** against a 720px viewport, on a page
whose every `<body>` child measured 720.

`sr-only` is `position: absolute`, and an absolutely positioned element is
clipped by an ancestor's `overflow` **only when that ancestor is its containing
block**. Nothing between those spans and `<html>` was positioned, so they
escaped `<main>`'s `overflow-y: auto` and extended the *root's* scrollable
overflow to wherever they sat. The bottom-most — the hidden `<figcaption>`
summarising the schools-by-city chart — sat at document y = **1185**, which is
`scrollHeight` exactly.

So the outer scrollbar was made of accessibility text and scrolled a region with
nothing painted in it. `position: relative` on the scroll container in both
shells is the fix. Verified: root scrollbar 15 → 0, root max scroll 465 → 0.

**F5 — "All healthy — an improvement".**
`StatTile` appends the delta's direction in words for screen readers, which is
right for `+12%` and nonsense for a phrase. Four tiles pass a phrase, so a
screen-reader user heard *"All healthy — an improvement"* and *"Nothing unread —
change"*. A `deltaKind="state"` prop suppresses the suffix where the text
already carries the meaning. Verified: only `+2` and `+0` now carry one.

Two smaller things were fixed in passing: the header search box had collapsed to
**165px** between a long school name and the sign-out control (it now has a
16rem floor, measured at 240px afterwards), and a ticket submitted by the
platform operator — who has no `school_users` row by design — rendered a raw
uuid where the sender's name belongs.

---

## Not executed, and why

- **The teacher, parent and student portals were not signed into.** No account
  for those roles exists on the live tenant, and none was created for a QA run.
  UC-S16-77 to 79 are the cases this leaves open. Their pages do refuse the
  wrong role (UC-S16-80), and the scope each one applies is a single `inArray`
  over a list resolved by an existing, check-covered query.
- **No screenshots.** The browser pane would not composite frames. Every
  observation here is from the DOM, computed CSS, the parsed server HTML, the
  network log or the database.
- **The file-picker interactions** (UC-S16-13, 14) need a painted page.
- **A >10 MB attachment** (UC-S16-12) was not driven; the constant is shared
  between the form and the route, and the route's other refusals were.
- **`sr-only` overflow was not swept across the whole product.** The fix is on
  the two scroll containers every portal screen renders inside, which is where
  it matters; a public page that scrolls normally is unaffected by construction.
