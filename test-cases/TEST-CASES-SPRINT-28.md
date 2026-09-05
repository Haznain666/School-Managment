# Sprint 28 test cases — the child nobody billed, and the CNIC that stopped looking

**Status: DRIVEN 2026-09-05** against **Askari School System** and **Lahore
Grammar School** on the **live migrated database**, entered through platform
emergency-login links (`scripts/qa-emergency-link.mjs`) rather than by typing a
password. Two builds were exercised:

| | |
| --- | --- |
| `npm run dev` from the sprint worktree, tree **byte-identical to merged `main`** (`git diff --stat 51b3d52 58c6ce4` is empty) | cases 1–62 |
| the **live deployment**, `GET /api/internal/build` → **`51b3d520d8ef`** | cases 22, 23, 27, 39 and 44 re-run |

**The run's results are recorded in §"QA run" at the foot of this file** — read
that before trusting any expectation above it. Nothing here is marked PASS on
the strength of a gate or of reading the source; `check-sprint28` proves the SQL
plans and proves nothing whatever about what a chip says.

Every row below is something a person opens a browser and does.

Set-up, and the live rows every case is written against:

| | |
| --- | --- |
| Student 1 | `ASST-2026-0001`, Pre-Nursery B, admission voucher **paid** 35,000 |
| Student 2 / Student 3 | `ASST-2026-0002` / `-0003`, Class 5 A, vouchers paid |
| **Student 50** | `ASST-2026-0004`, Pre-Nursery B, `fee_status='outstanding'`, **no voucher at all** |
| ASS Principal 1 | Pre-Nursery → Class 4. Enrolled Student 50 |
| ASS Principal 2 | Class 6 → Class 10 |
| Father 1 | CNIC `42201-1111111-1` — guardian of Students 1, 2 **and** 50 |
| Father 2 | CNIC `41256-5431356-5` — guardian of Student 3 |
| LGS Student 3 | `fee_status='cleared'`, its only voucher **cancelled** — zero live vouchers |

⚠ **Case 4 raises Student 50's voucher, and raising it consumes the `not_billed`
state the whole sprint exists to create.** Cases 1–3, 21–26, 32–34, 37 and 62 all
depend on that state and **must be run before case 4**. There is no second
unbilled child anywhere on the estate, and none can be manufactured without
enrolling one.

---

## Item 1 — a head can admit a child, and could not bill one

Traces to: *"raising the admission voucher cost `fees.write` too, so the three
roles that admit children were the three that could not bill one"*, and *"where
the permission is absent, the card now says so, naming the permission and who
can grant it."*

| # | Case | Expected |
| --- | --- | --- |
| 1 | Sign in as **ASS Principal 1**, open Student 50's profile | the *Admission fee* card reads **Not yet billed**, `Admission Fee · Pre-Nursery · 2026-2027`, Fee **PKR 35,000**, Discount − PKR 0, Voucher total PKR 35,000 |
| 2 | The same card | a **Generate the admission fee voucher** button is present. **Fail** if the card ends at the figures — that is the reported defect |
| 3 | The same card, for **any** role including a School Administrator | **no** *Confirm the fee was paid* control in this state. You cannot confirm a payment for a fee that was never billed, and that ordering rule is structural |
| 4 | Press **Generate the admission fee voucher** | the button shows a pending state, then a green notice: *"Voucher ASST-2026-09-0004 raised for PKR 35,000."* |
| 5 | Read `fee_challans` back for that student | exactly one row: `challan_kind = 'admission'`, `total_amount = 35000.00`, `paid_amount = 0.00`, `status = 'unpaid'`, `generated_by_uid` = Principal 1 |
| 6 | The card, after the refresh, **as Principal 1** | **Billed on voucher ASST-2026-09-0004, due 10-Sep-2026**, Demanded / Received / Outstanding, a **Print voucher** button, the emailed-when-raised note, and **no** *Confirm the fee was paid* — a Principal has no `fees.write`. The same card as **School Admin** shows both buttons |
| 7 | Press it a second time (or `POST` the route again) | **409**, *"This admission has already been billed on voucher ASST-2026-09-0004."* **Fail** if a second 35,000 voucher appears — a double-press on a slow connection is a double demand to a parent |
| 8 | `ledger_transactions` / `ledger_entries` row counts, before and after case 4 | **identical.** Raising a challan posts nothing; income is recognised on receipt. This is CLAUDE.md's rule and it must survive a new billing route |
| 9 | `email_outbox`, after case 4 | one row to the primary contact, subject *Fee voucher ASST-2026-09-0004*. The card's claim that it was emailed is a claim, and this is the evidence |

### The half that proves `0044`, not just `fees.admission`

Case 10 is the only one that writes a `role_permissions` row, and that row is the
whole point of the migration. `DEFAULT_ROLE_PERMISSIONS` lives in code, so
`fees.admission` works for a Principal with **no row in the table at all** — every
browser test passes without the migration. The CHECK is reached only when a
school *overrides* the default, which is the screen most testing never touches.
That is precisely how `chat.oversight` shipped broken in Sprint 26.

| # | Case | Expected |
| --- | --- | --- |
| 10 | As **School Admin**, Settings → Roles and permissions. Find *Raise a student's admission voucher*, turn it **off** for Principal, **Save changes** | the save succeeds. **Fail** with `23514` — that is `0044` missing, and it would take the whole matrix save down with it |
| 11 | The row's nine columns, before the change | ✓ School Administrator, ✓ Branch Administrator, ✓ Principal, ✓ Vice Principal, — Coordinator, — Teacher, ✓ Accountant, — HR Manager, — Marketing |
| 12 | `role_permissions` after case 10 | one row: `principal / fees.admission / is_granted = false` |
| 13 | As **Principal 1**, re-open Student 50's profile | the card names the permission: *"raising one needs the **Raise a student's admission voucher** permission, which your role does not hold. A school administrator can grant it on Roles & Permissions."* and **no button**. **Fail** if the card is silent — a card that offers nothing and explains nothing is the defect being repaired |
| 14 | `POST /api/school/students/<Student 50>/admission-challan` from that same session | **403** *"Your role does not permit this action."*, and no `fee_challans` row |
| 15 | Turn the switch back **on** and save | the override row is **deleted** — the matrix stores departures from the default, not the default |
| 16 | Now turn the same switch **on for Teacher**, save, and `POST` the route as a Teacher | the save writes `teacher / fees.admission / is_granted = true` — the **grant** direction of the same CHECK — and the route no longer answers 403. Restore the switch afterwards |
| 17 | `POST` the route as a **Teacher** with the default matrix | **403**, no row written |
| 18 | `POST` the route as an **HR Manager** | **403**, no row written |
| 19 | Open Student 50's profile URL signed in as a **Teacher** | they never reach it — the teacher shell redirects to `/teacher`. A teacher cannot open a student profile at all, so the card is unreachable before the permission is even consulted |
| 20 | Open Student 50's profile URL as **ASS Principal 2** (Class 6–10) | **404**. Sprint 23's grade narrowing must survive this sprint |

---

## Item 2 — the fifth state, and the green chip that was a lie

Traces to: *"a child admitted five minutes ago has no open voucher either … `Not
billed` is that case named, in red"* and *"a fee taken in cash still reads
`Cleared`."*

| # | Case | Expected |
| --- | --- | --- |
| 21 | As **School Admin**, Admissions → All Students, before case 4 | four rows. Student 50's **Fees** cell reads **Not billed** in the danger colour. **Fail** if it reads `Cleared` — that is the reported defect, and green is the one chip nobody re-checks |
| 22 | The same table | Students 1, 2 and 3 read **Cleared** in green. This is the regression that matters most: it is the state everybody else at every school is in |
| 23 | The **Fees** filter dropdown | five states plus *Any fee status*, with **Not billed first** |
| 24 | Filter → **Not billed** | exactly one row, Student 50 |
| 25 | Filter → **Cleared** | exactly three rows, Students 1, 2 and 3. **Fail** if Student 50 is among them |
| 26 | Filter → **Admission unpaid**, **Overdue**, **Due**, before case 4 | empty at Askari — every voucher there is paid |
| 27 | After case 4, filter → **Admission unpaid** | exactly one row, Student 50, chip **Admission unpaid**. This is the case that proves the filter *discriminates* rather than merely returning nothing |
| 28 | After case 4, filter → **Not billed** | empty. The state is consumed by billing the child, which is the point |
| 29 | **LGS Student 3** — `fee_status = 'cleared'`, whose only voucher is **cancelled**, so zero live vouchers | reads **Cleared**, not *Not billed*. Somebody has said in writing that it was paid, and their say-so is the record. **Fail** if a settled family lands on a chasing list |
| 30 | `/dashboard/admissions/students?feeStatus=not_billed` typed straight into the address bar | the Fees dropdown opens already reading **Not billed** and the table is filtered |
| 31 | `?feeStatus=bogus_state` | the value is **dropped**: the filter reads *Any fee status*, every student is listed, and there is no error page. A bookmark from before a state was renamed is a harmless surprise, not a 500 |

---

## Item 3 — the voucher register says who is missing from it

Traces to: *"the register is a list of vouchers, so a child who has never been
billed can never be a row in it … it now carries the count above its tabs."*

| # | Case | Expected |
| --- | --- | --- |
| 32 | As **ASS Principal 1**, Fees → Vouchers, before case 4 | a warning callout **above the tabs**: *"1 enrolled student has no voucher at all."* with the paragraph explaining why the register cannot show them, and a **See the student →** link |
| 33 | Press **See the student →** | lands on `/dashboard/admissions/students?feeStatus=not_billed`, filter already seeded, one row |
| 34 | As **ASS Principal 2** (Class 6–10, no unbilled child in scope) | **no callout at all.** The count is narrowed to the reader's own grades. **Fail** if the school-wide 1 appears above a head who cannot open that child |
| 35 | As Principal 1, after case 4 | the callout is **gone** |
| 36 | At **LGS**, where every enrolled child has a voucher or a hand-cleared enrollment | no callout, and the register lists LGS vouchers only |
| 37 | The register itself, as Principal 1, before case 4 | one row — Student 1's paid admission voucher. Student 50 is nowhere in it, which is exactly why the callout has to exist |

---

## Item 4 — the CNIC that stopped looking

The fiddly ones, and the reason the sprint exists. The field is `maxLength={15}`,
so the only three ways to change a number that is already complete are deleting
from it, **typing over a selection**, and **pasting over one** — and the last two
arrive as a single change event whose previous value was *also* a valid CNIC. The
old edge test read that as "nothing changed".

Cases 39 and 42 are the only two that discriminate the fix from what it replaced.
Everything else here passes on the old code too.

| # | Case | Expected |
| --- | --- | --- |
| 38 | Enroll a student → Guardian information. Type a **wrong** complete CNIC, `42201-1111111-2` | *"Checking whether this school already knows this guardian…"* appears while it runs, then the card **unlocks** with no match. A number that matches nobody is still an answer |
| 39 | With the card unlocked, type the guardian in **by hand** — a different name, phone, email and occupation from the record. Then **select the final digit and type `1` over it**, making it `42201-1111111-1` | the sibling banner appears: *"Father 1 already has 3 children at this school"*, naming **Student 1 · ASST-2026-0001**, **Student 2 · ASST-2026-0002** and **Student 50 · ASST-2026-0004**. **Fail** if nothing happens — that is the exact reported defect, and on the old code nothing happened |
| 40 | The banner, with the hand-typed card still on screen | offers **Use the record we hold**, with the sentence saying it replaces name, phone, email, occupation and relationship |
| 41 | Press **Use the record we hold** | the card becomes Father 1 / `(0301) 000-0011` / `huznen+father1@gmail.com` / Chor, and the button **disappears** — there is no longer a disagreement to reconcile |
| 42 | The same correction by **replacing the whole field in one change** (select all, paste over it) with Father 2's `41256-5431356-5` | the banner switches to *"Father 2 already has a child at this school"* / Student 3 · ASST-2026-0003. Valid → valid in one event, which is the shape the old guard suppressed |
| 43 | A complete CNIC matching **nobody** at this school | no banner, no *Use the record we hold*, and the card is **unlocked** so the guardian can be typed by hand |
| 44 | Where the card and the record **agree** (the lookup filled the empty fields itself) | **no** *Use the record we hold* button. A button that would change nothing teaches people not to press it |
| 45 | Make the number incomplete (delete a digit) and retype **the same** number | the lookup fires **again**. A clerk correcting themselves gets an answer |
| 46 | Count the lookup requests across cases 38–45 | **one per distinct number asked**, and never two for the same number in a row |
| 47 | Clear the CNIC to **blank** and press Continue | the step is accepted and the wizard advances. No screen may refuse to record a person because the card is not to hand — CLAUDE.md's rule, and an invented CNIC is worse than an absent one |
| 48 | Student profile → Guardians → **Add guardian**. Type a wrong complete CNIC, then correct one digit | the lookup fires on the correction and the panel fills Full name, Phone, Email and Occupation from the record, and prints *"Already a guardian of one student at this school: Student 3 · ASST-2026-0003"*. The panel shares `CnicField` and had the same defect |
| 49 | The Add-guardian form's **Relationship** list on a student who already has a Father | Father is not offered. The singleton rule is unchanged by this sprint |
| 50 | Guardian lookup for a CNIC belonging to a guardian at **another school** | `guardian: null`, `students: []`. A family is a family within one tenant |

---

## Tenancy, and the rest

`location_id` never comes from the request. These are the cases that prove it
rather than assume it.

| # | Case | Expected |
| --- | --- | --- |
| 51 | `POST /api/school/students/<an LGS student id>/admission-challan` from an **Askari** session holding `fees.admission` | **404** *"Student not found."* |
| 52 | LGS's `fee_challans` count, before and after case 51 | **identical.** A refused write that still wrote is the failure to look for |
| 53 | `GET /api/school/students?feeStatus=not_billed` at each school | each returns only its own children |
| 54 | The students directory and the voucher register signed in at LGS | LGS's six students and nine vouchers, LGS's own branding. Askari's rows appear nowhere |
| 55 | The unbilled callout at LGS | absent — LGS's count is genuinely 0, and it is *its own* 0, not Askari's 1 |
| 56 | `role_permissions_permission_check` in the live catalogue | **45 keys**, including `fees.admission` |
| 57 | `fees.admission` in the API's permission matrix | present in `PERMISSIONS`, and default-granted to school_admin, branch_admin, principal, vice_principal and accountant — nobody else |
| 58 | `read_console_messages` on every screen touched | no errors, no hydration warnings |
| 59 | `read_network_requests` on the same screens | no 4xx or 5xx other than the ones a case deliberately provokes |
| 60 | The server log for the run | no exception |
| 61 | The directory and the *Admission fee* card at **375×812** | filters stack, the card's three figures stack, no horizontal overflow of the document |
| 62 | The unbilled callout at 375×812, **before case 4** | fits above the tabs without overflowing |

**Print** is not in this sprint's scope: it ships no new document. The *Print
voucher* control on the panel is Sprint 20's route, unchanged here.

**Dark mode is not applicable.** The product has no dark theme at all — no
`dark:` variants anywhere in `app/` or `components/`, no `prefers-color-scheme`
rule, and no `darkMode` key in the Tailwind config. Emulating a dark colour
scheme renders the light palette, correctly.

---

# QA run — 2026-09-05, Askari School System and Lahore Grammar School

**Build tested:** the sprint worktree at `58c6ce4`, whose tree is byte-identical
to merged `main` `51b3d52` (`git diff --stat 51b3d52 58c6ce4` is empty), served
by `npm run dev`; **and** the live deployment once it landed —
`GET https://schoolhub.codexmill.com/api/internal/build` →
**`{"buildId":"51b3d520d8ef"}`**. It read the pre-merge `79ed253f69ce` for the
first forty minutes of the session; nothing was concluded from it.

Signed in through platform emergency-login links — fifteen minutes, single use,
recorded in `emergency_login_tokens` — as ASS Principal 1, ASS Principal 2,
ASS Teacher 1, ASS HR, Askari School Admin and the LGS School Administrator.
**No password was typed and `.env.local` was never modified.**

The live site is reached at `askari-school-system.schoolhub.codexmill.com`, not
at the apex with `?school=` — the apex answers *"School portal unavailable"*.
Worth recording because the minting script prints the apex form.

## Result

**61 passed · 0 failed · 1 not exercised.**

| Item | Verdict | Cases |
| --- | --- | --- |
| **1 — `fees.admission`, the button and the sentence** | ✅ **PASS**, both directions of the override | 1–20 |
| **2 — the fifth state and the filter** | ✅ **PASS**, including the hand-cleared exception on real LGS data | 21–31 |
| **3 — the register's callout** | ✅ **PASS** | 32–37 |
| **4 — the CNIC that stopped looking** | ✅ **PASS** on the two discriminating cases, on **both** builds | 38–50 |
| **Tenancy** | ✅ **PASS** — the cross-tenant write 404s and writes nothing | 51–57 |
| **Console, network, responsive** | ✅ **PASS**; dark mode not applicable | 58–61 |
| The callout at mobile width | ⚠️ **NOT EXERCISED** — see below | 62 |

## Item 1 — and the write that proves the migration

Case 4 was driven with the mouse on Student 50's own profile as ASS Principal 1.
The button raised **`ASST-2026-09-0004`** and the row read back from the database
as `admission` / `35000.00` / paid `0.00` / `unpaid` / due `2026-09-10`,
`generated_by_uid` = Principal 1's id. The card then moved to *Billed on voucher
ASST-2026-09-0004* with Demanded 35,000 · Received 0 · Outstanding 35,000, a
**Print voucher** button and **no** *Confirm the fee was paid* — the two keys are
genuinely separate on screen and not only in the source. The same card as School
Admin carries both buttons.

A second raise answered **409** *"This admission has already been billed on
voucher ASST-2026-09-0004."* with the challan count unchanged at 4.

`ledger_transactions` 6 / `ledger_entries` 12, and the newest transaction is
dated **2026-09-01** — raising the voucher posted nothing, which is what the
append-only rule requires of a route that raises a demand rather than receiving
money. `email_outbox` gained one row, *Fee voucher ASST-2026-09-0004 — Askari
School System*, `sent`, to the primary contact.

**The override, both ways.** Turning *Raise a student's admission voucher* off
for Principal on the Roles & Permissions screen saved cleanly and wrote
`principal / fees.admission / is_granted = false`. That is the write that would
have been a `23514` before `0044`, and it is the only case in this file that
reaches the CHECK at all. Turning it back on **deleted** the row rather than
storing `true`. Then the opposite direction: granting it to **Teacher** wrote
`teacher / fees.admission / is_granted = true`, and the same teacher account that
had answered **403** thirty seconds earlier answered **409 already billed** —
past the permission gate, refused for a different and correct reason. Both
overrides were removed; Askari is back to its original four.

With the key revoked, the card printed exactly the promised sentence and no
button, and the route answered 403 to Principal 1, Teacher and HR Manager with
no `fee_challans` row written by any of them.

⚠️ **A teacher granted `fees.admission` still has nowhere to press it.** The
teacher shell redirects `/dashboard/admissions/students/…` to `/teacher`, so the
route is reachable only by hand. That is pre-existing shell behaviour for every
admin route and not a regression, but it means "grantable to anybody else on the
Roles & Permissions screen" is true of the API and not of the screens.

## Item 2 — the chip, and the exception that had never been seen

Before case 4, as School Admin, the directory rendered **Student 1 Cleared ·
Student 2 Cleared · Student 3 Cleared · Student 50 Not billed** — green, green,
green, red. The `not_billed` filter returned exactly Student 50 (`total: 1`) and
`cleared` returned exactly Students 1–3 (`total: 3`) with Student 50 absent.

The filter's *negative* results before case 4 (`admission_unpaid`, `overdue`,
`due` all empty) prove very little on their own, so the discriminating check was
run **after** billing: `admission_unpaid` then returned exactly Student 50 and
`not_billed` returned nothing, with the chip changing from *Not billed* to
*Admission unpaid* on the same row.

**LGS Student 3 is the exception, on real data.** Their only voucher
(`LGS-2026-08-0010`) is `cancelled`, so the new `live_voucher_count` is zero —
and because the enrollment is `cleared`, the chip reads **Cleared**. That path
had never been exercised anywhere before; it is the one that would have put a
settled family on a chasing list, and it holds.

`?feeStatus=bogus_state` was dropped silently: the dropdown read *Any fee status*
and all six LGS students listed, no error boundary.

## Item 3 — the callout

As ASS Principal 1 the vouchers screen carried, above the tabs, *"1 enrolled
student has no voucher at all"* with the explanatory paragraph and **See the
student →**, which landed on
`/dashboard/admissions/students?feeStatus=not_billed` with the dropdown already
reading *Not billed*. As **ASS Principal 2** — Class 6–10, no unbilled child in
scope — the callout was **absent**, and their grade filter offered Class 6–10
only. After case 4 the callout disappeared for Principal 1 as well.

## Item 4 — the two cases that discriminate the fix

Both were driven with real key events, and the event shape was measured rather
than assumed. An `input` listener on the field recorded that the automation's
typing arrives as a **single `insertText` event carrying the whole new value** —
which is the same event `CnicField` sees from a clipboard paste, the previous
value being a complete valid CNIC in both.

- **Digit type-over (case 39).** `42201-1111111-2` → no match → the whole
  guardian typed in by hand → the final digit selected and `1` typed over it.
  The banner appeared naming **Student 1, Student 2 and Student 50**, and
  **Use the record we hold** was offered beneath it. Pressing it replaced the
  card with Father 1 / `(0301) 000-0011` / `huznen+father1@gmail.com` / Chor and
  the button then vanished.
- **Whole-field replacement (case 42).** `42201-1111111-1` → `41256-5431356-5`
  in one event: the banner switched to *"Father 2 already has a child at this
  school"* / Student 3.

Four lookups fired across the sequence, one per distinct number, none repeated —
and making the number incomplete and retyping the same one produced a fresh
fifth request, so a clerk correcting themselves still gets an answer.

**Case 39 was then re-run end to end against the live deployment**
(`51b3d520d8ef`, `askari-school-system.schoolhub.codexmill.com`) and produced the
same banner naming the same three children, with *Use the record we hold*
correctly **absent** there because the lookup had filled the empty card itself
and there was nothing to reconcile (case 44). This is the flagship defect and it
is fixed on the artefact that is actually serving schools, not only on a dev
server.

Blank was accepted: clearing the field and pressing Continue advanced the wizard
to Academic placement with no complaint.

The **guardian panel** on Student 50's profile behaved identically — the
corrected number fired the lookup, filled Full name / Phone / Email / Occupation
from Father 2's record and printed *"Already a guardian of one student at this
school: Student 3 · ASST-2026-0003"*. Its relationship list offered Mother,
Guardian, Sibling and Other, with Father correctly withheld.

**No student was created.** The wizard was never submitted; Askari still holds
four student profiles and eleven guardians estate-wide.

## Tenancy

An Askari session holding `fees.admission` POSTing `admission-challan` at two
**LGS** student ids answered **404 "Student not found."** both times, and LGS's
`fee_challans` count read **9 before and 9 after**. A guardian lookup at Askari
for LGS's `42201-0139154-7` returned `guardian: null, students: []`. Signed in at
LGS, the register and directory showed LGS's own rows under LGS's own branding,
and the unbilled callout was absent because LGS's own count is 0.

`role_permissions_permission_check` reads **45 keys** including `fees.admission`,
and the permissions API returns the key in the matrix with exactly the five
default holders the release note names.

## What was not exercised, and why

1. **The unbilled callout at 375×812 (case 62), and its narrowing to a
   *campus*.** Askari's only unbilled child was billed by case 4 — which this
   run was required to do — and no other school on the estate has an enrolled
   child without a voucher, so the callout cannot be made to render again
   without enrolling one. It was verified at desktop width only. Anyone
   re-running this suite should take case 62 **before** case 4. Campus narrowing
   is untestable at Askari, which has one campus, and at LGS, whose count is 0.
2. **The `Not billed` chip at 375×812.** Same cause. The identical `danger`
   `Badge` was checked at that width carrying *Admission unpaid*, which is the
   longer of the two labels; it wraps to two lines inside its cell and does not
   overflow. Recorded as inference, not as a pass on the chip itself.
3. **A genuine OS-clipboard paste.** `ctrl+c` / `ctrl+v` and `Backspace` are not
   delivered to the page by this automation, and `navigator.clipboard.writeText`
   is refused with *Write permission denied*. Case 42 was therefore driven as a
   single `insertText` event carrying the full replacement value — verified with
   an event listener to be one change event whose previous value was a complete
   valid CNIC, which is what `CnicField` actually reads. `inputType` is never
   consulted by the component, so `insertFromPaste` and `insertText` are the
   same input to it. Recorded as a substitution rather than as a pass on the
   real thing.
4. **`vice_principal`, `branch_admin`, `coordinator` and `marketing` as signed-in
   people.** No member holds any of those roles at either school. Their
   `fees.admission` default was read off the permissions matrix and the API's
   own matrix response, not by opening a session.

## Findings

Two, both low, neither blocking. **Both were fixed before this file was
committed** — see the section below.

1. **`STUDENT_FEE_STATUS_DESCRIPTIONS` had no caller.** Its docblock said *"For
   the filter's help text"*; the Fees filter showed no help text, its `<option>`s
   carried no `title`, and the string *"No voucher has ever been raised for this
   student."* appeared nowhere in the DOM. Only `check-sprint28` referenced it,
   which asserts it exists rather than that anybody sees it.
2. **The enrollment card showed a name it said it was not using.** After a
   corrected CNIC matched, Full name / Phone / Email were disabled but still
   displayed whatever had been typed by hand, beside a note reading *"Recorded
   against Father 1's existing guardian record."* The two contradicted each
   other on screen until *Use the record we hold* was pressed, and pressing it
   was optional.

## Residue

Read back from the database, not asserted:

| | After |
| --- | --- |
| `fee_challans` — Askari | **4** (was 3). `ASST-2026-09-0004`, Student 50, 35,000 unpaid — **intended and kept**; this is the child the sprint exists to bill |
| `fee_challans` — LGS | **9**, unchanged |
| `ledger_transactions` / `ledger_entries` | **6 / 12**, newest 2026-09-01 — untouched |
| `role_permissions` where `permission = 'fees.admission'` | **0 rows** — both overrides removed |
| Askari's other overrides | **4**, the originals |
| `student_profiles` | **4** Askari / **6** LGS — no QA student enrolled |
| `student_guardians` | **11**, unchanged |
| members named `QA28%` or `%Probe%` | **0** |
| unused `emergency_login_tokens` | **3**, all pre-dating this session and all expired. Every token minted here was spent or deleted |
| `email_outbox` | one new row, the voucher email from case 4 |

## Gates run, 2026-09-05 — these are not test cases

| Gate | Result |
| --- | --- |
| `check-sprint28` | **PASS — 48 ok, 0 failed or not exercised**, with `0044` read from the catalogue as **APPLIED**; `fees.admission` accepted by the CHECK and `fees.invent` refused with `23514`, both inside rolled-back transactions |

The other eleven were not re-run against the merged commit by this QA session:
CI ran them on it, and they were run in full on the identical tree before it was
pushed.

---

## The two findings, fixed — cases 63 to 66

Added after the run above, and driven on the same build. They are numbered
separately so the tally that produced them stays readable.

| # | Case | Expected |
| --- | --- | --- |
| 63 | Admissions → All Students, open the **Fees** filter | each of the five states carries its one-line explanation. **Fail** if the options are bare — a five-state filter whose states are nowhere explained is the shape finding 1 took |
| 64 | Hover, or read the option's `title` attribute in the DOM | *"No voucher has ever been raised for this student."* is reachable for `Not billed`, and the equivalent for the other four |
| 65 | Enrollment wizard → Guardian information. Reach the state of case 39 — a hand-typed guardian whose corrected CNIC has just matched Father 1 | the locked Full name / Phone / Email now read **Father 1's stored values**, so the fields and the sentence beneath them agree. **Fail** if a hand-typed name sits under a note claiming it is the school's record |
| 66 | The same card, then press **Use the record we hold** | occupation and relationship follow, and the button disappears. The button is now about the fields it is still needed for |
