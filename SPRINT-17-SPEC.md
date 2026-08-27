# Sprint 17 — onboarding, the admission fee, and the discount that never applied

Twelve defects and requirements reported by the product owner on 2026-08-27,
after driving the school-admin and principal portals against Lahore Grammar
School. Every one of them is traced to a line of code below, and three were
confirmed against the live database before anything was written.

**Migration number: `0033`.** It is the next free one — `db/migrations/` ends at
`0032`.

Read `CLAUDE.md` first. Nine gates must pass, plus `check-dashboard`,
`check-reports` and `check-portals`, which this sprint touches.

---

## What was measured on the live database, 2026-08-27

These are facts, not guesses, and three of the twelve items are already
explained by them.

| Query | Result |
| --- | --- |
| `schools` where slug = `lgs` | `principal_model = 'multiple'` |
| `principal_assignments` for LGS | **0 rows** |
| `branches` for LGS | 1 — *Defence Branch* |
| `grades` for LGS | 14, every one on that branch |
| `fee_types` × `fee_structures` for LGS | Tuition 14/14 grades, Admission 14/14, Annual 14/14, Library 14/14, **Examination 0/14** |
| the sibling discount | `applies_to_fee_type_id = NULL`, 20%, open-ended |
| `student_profiles.photo_url` for *Student 5* | **null** |

---

## Item 1 — a new member gets a password-creation email, not a code

**Decided:** every school-portal invitation switches, not only principals.

### What happens today

`POST /api/school/invitations` writes a `school_invitations` row and mails an
invite link. The link lands on `app/(public)/invite/[token]/page.tsx`, which
renders `InviteOTPForm`: the invitee types their name, receives a **six-digit
code** by email, and transcribes it. Two emails, and the second one proves the
same mailbox the first one already proved.

Meanwhile the platform's own path — `createFirstSchoolAdmin` in
`app/api/super-admin/schools/route.ts` — calls `queueAccessEmail`, which mints a
`password_setup_tokens` row and mails a single `/set-password/<token>` link.
That is the flow the product owner means by "as sent to other users".

### What to build

`POST /api/school/invitations` keeps its shape — it still validates name, phone,
email, role and branch, and it still refuses a blank address for the reason the
existing comment gives. What changes is what it *does* once validation passes:

1. Create the `school_users` row immediately, exactly as
   `POST /api/school/users` does (same tenant-from-session rule, same phone
   uniqueness conflict → 409).
2. Call `queueAccessEmail({ locationId, school, member, createdBy: auth.uid })`
   with `authUserId: null`, so it takes the first-time branch and mails the
   set-password link.
3. Return the created member and the `AccessEmailResult` so the form can say
   plainly whether the message was queued and, if not, why.

`school_invitations` is **not** dropped and the migration must not touch it.
Rows already in it are live invitations somebody may still click, and
`app/(public)/invite/[token]/page.tsx`, `InviteOTPForm` and the accept routes
stay exactly as they are so those links keep working until they expire. Nothing
new is written to that table.

`PendingInvitesTable` currently lists `school_invitations`. Leave it listing
them — it is now the record of invitations sent before this deploy — but the
"Invite pending" state for members created from now on already exists: it is
`school_users.auth_user_id IS NULL`, which `UserTable` renders today.

The resend button (`.../invitations/[inviteRef]/resend`) keeps working for old
rows. For new members the equivalent is the existing
`POST /api/super-admin/schools/[schoolId]/users/[userId]/send-signin`; add a
school-side twin at `POST /api/school/users/[userId]/send-access` behind
`users.write` that calls the same `queueAccessEmail`, and wire it to a
**Send access email** action on `UserDetailPanel`.

### Do not

Do not delete the OTP acceptance route or the code path in
`lib/school-auth.ts`. Forgot-password still uses a code, and that is correct —
an established account must prove the mailbox.

---

## Item 2 — the principal sees 50% where the administrator sees 100%

### Why, exactly

`getSetupProgress(locationId, scope)` takes an `AggregateScope`. The dashboard
passes the *principal's* scope. LGS runs `principal_model = 'multiple'` and has
**no `principal_assignments` rows at all**, so `resolvePrincipalScope` returns
`unassigned: true` and `resolveDashboardScope` turns that into `gradeIds: []`.

Three of the six steps — Classes, Timetable, Enrolled students — are the
grade-scoped ones. They short-circuit to `0` on an empty scope. Three of six
done is **50%**, to the digit.

### The fix

**Setup progress is a school-wide fact and is never narrowed.** Whether the
school has created classes, priced its fees or enrolled anybody is a question
about the school, not about one head's division; a principal who has been
assigned the O-Levels should not be told the school is half-built because the
junior school is somebody else's.

`getSetupProgress` drops its `scope` parameter and always counts the whole
tenant. The dashboard stops passing `aggregateScope` to it, and
`SetupProgressCard` drops its `scoped` prop and the sentence that explained the
narrowing.

Every *other* aggregate keeps its scope. This is one function.

### And say the real thing out loud

An unassigned head at a `multiple` school sees an empty school on every screen,
not just this one. `describeScope` already returns the sentence for it. Render
that sentence as a **warning callout at the top of the principal's dashboard**,
not as grey helper text, and link it to `/dashboard/settings` where assignments
are made. Do not relax `resolvePrincipalScope` — STATE.md is explicit that
"no assignment" must never resolve to "no filter", and it is right.

---

## Item 3 — a new school gets its fee heads automatically

`POST /api/super-admin/schools` already seeds two things after the school row
commits: `seedChartOfAccounts` and `seedResultSubcategories`. Add a third, on
exactly the same terms — its own `try`/`catch`, logged rather than swallowed,
never failing the request.

Move the body of `POST /api/school/fees/types/seed` into
`seedDefaultFeeTypes(locationId)` in `lib/school-bootstrap.ts` and call it from
both places. It is already idempotent through
`onConflictDoNothing({ target: [feeTypes.locationId, feeTypes.name] })`, so the
existing Seed button stays a no-op re-run.

**Only the five heads. No `fee_structures` rows.** A new school has no grades
and no academic year, so there is nothing to price; and writing an amount of `0`
would tell Item 12's KPI that every fee is deliberately free on day one, which
is the one thing that would make that KPI meaningless. The school types its own
amounts, and Item 12 is what measures whether they have.

---

## Items 4–7 — the admission fee panel, rebuilt

One component, four requirements, four states. `FeeClearancePanel` is already
titled *Admission fee*; what it is missing is any connection to the **Admission
Fee head in the fee structure**, which is what the product owner means by the
words.

### The resolver

Add `lib/admission-fee.ts`, server-only, exporting one function:

```ts
resolveAdmissionFee(locationId, studentProfileId): Promise<AdmissionFeeState>
```

It resolves, in this order:

1. The student's **active** enrolment — grade and academic year. No active
   enrolment ⇒ state `not_enrolled`; the panel does not render at all, which is
   the rule the profile page already applies.
2. The school's **one-time Admission Fee head**: the `fee_types` row for this
   tenant whose `fee_category = 'one_time'` and whose name matches
   `Admission Fee` case-insensitively, falling back to the lowest `sort_order`
   `one_time` head. A school that renamed it keeps working; a school that
   deleted it gets state `no_fee_head`.
3. The `fee_structures` row for (that head, that grade, that year).
4. Any existing challan for this student that carries an **admission line** —
   a `fee_challan_items` row with that `fee_type_id`.

`AdmissionFeeState` is a discriminated union on `kind`, and the panel switches
on it. No booleans; four states with four different things to say.

### The four states

| `kind` | When | The panel shows |
| --- | --- | --- |
| `no_amount` | no `fee_structures` row for this head/grade/year, **or** the row is absent entirely | **Item 5.** A danger callout — `status-danger-subtle`, `role="alert"`, an alert icon — reading that the admission fee has not been set for *«grade»*, and a primary link to `/dashboard/fees/structures`. **No voucher button. No payment-confirmation button.** |
| `not_billed` | an amount exists (including a deliberate `0`) and no admission challan | **Items 6 & 7.** *Generate the admission fee voucher* as the primary action, showing the amount it will bill and the discount it will apply. **The payment-confirmation button is not rendered.** |
| `billed` | an admission challan exists and is `unpaid` / `partial` | The challan number, the amount, a link to it — and *now* the *Confirm the fee was paid* button, behind `fees.write` exactly as today. |
| `settled` | the admission challan is `paid` / `waived` / `cancelled`, or the enrolment is already `cleared` | Today's cleared wording, plus the challan number when there is one. |

The ordering rule the product owner stated is the whole point and must hold in
the component, not only in prose: **the confirm-payment control exists only in
`billed` and `settled`.** A reviewer must be able to read one `switch` and see
that.

### Generating the voucher

New endpoint `POST /api/school/students/[studentId]/admission-challan`, behind
`fees.write`, branch-scoped like every other route on that student.

It calls a new `generateAdmissionChallan(db, params)` in `lib/fee-challans.ts`.
That function is `generateChallan` with three differences:

* `billingMonth` and `billingYear` are **null**. `fee_challans`'s unique index
  is on (student, month, year, year-id) and Postgres treats nulls as distinct,
  so this cannot collide with a monthly challan and the schema already allows
  it (`billing_month integer` is nullable, and the CHECK is `BETWEEN 1 AND 12`
  which passes for null).
* It bills **only the resolved admission head**, not `calculateChallanItems`'s
  monthly filter. Pass the single structure row and no `billingMonth`.
* It is refused with `already_exists` when `resolveAdmissionFee` already
  reports `billed` or `settled`. One admission, one admission fee.

The challan number comes from `generateChallanNumber` with the **current**
month and year, because that counter's key is the issuing period, not the
billing period.

Everything else — `batch()`, the reserved number, `ChallanGenerationError` —
is unchanged and must stay unchanged.

---

## Item 8 — the sibling discount that did not apply

### The bug, in one line

`lib/fee-calculator.ts`, `concessionPaiseFor`:

```ts
const matches =
  concession.appliesToFeeTypeId === null
    ? line.feeCategory === 'monthly'      // ← here
    : concession.appliesToFeeTypeId === line.feeTypeId;
```

A concession with no fee head named applies to **monthly heads only**. The
admission fee is `one_time`. LGS's sibling discount is exactly that row —
`applies_to_fee_type_id = NULL`, 20%, open-ended — so it could never reach the
admission fee, and nothing anywhere said so.

### The fix

A concession that names no head applies to **every head**, of every category.
That is what a school means when it writes "20% sibling discount" with no
qualifier, and it is what the product owner expected.

Change the line to `matches = true` in the null branch, and rewrite the
docstring above it so the next reader is not told the old rule. Update the
`student_concessions.applies_to_fee_type_id` comment in
`db/schema/student-concessions.ts` too — it says "every monthly fee head" and
would otherwise become the surviving copy of the bug.

A school that wants a monthly-only discount names the monthly head. That has
always worked and is the narrower, explicit case.

### The other half: a discount applied late

The product owner's rule, verbatim: *as long as the fee has not been paid, any
discount applied will be effective. If the discount has been applied afterwards,
then it will appear as adjustment in the next voucher.*

So writing or amending a concession must **reprice every open challan** for that
student.

Add `repriceOpenChallans(db, { locationId, studentProfileId, actorUid })` to
`lib/fee-challans.ts` and call it at the end of
`POST /api/school/fees/concessions` and `PATCH .../concessions/[concessionId]`.

For each of that student's challans whose status is `unpaid` or `partial` and
whose `family_challan_id` is null:

* recompute its lines from the **frozen `amount` already on each
  `fee_challan_items` row** and the student's concessions in force on that
  challan's `due_date`. The gross price is never re-read from
  `fee_structures` — a challan is a record of what was demanded, and March's
  tuition rise must not rewrite February's bill. Only the discount moves.
* rewrite `concession_amount` and `net_amount` per line, and the header's
  `concession_amount` and `total_amount`, in one `batch()`.
* if the new total is below `paid_amount`, clamp the header to `paid_amount`
  and carry the difference as a credit (Item 9).
* never touch a `paid`, `waived` or `cancelled` challan. That is the "applied
  afterwards" case, and its answer is the credit, not an edit.

A challan already folded into a family voucher is skipped and reported, because
the voucher is what the parent is holding.

---

## Item 9 — a voucher can never total less than zero

### The credit ledger

Migration `0033` adds one table:

```sql
CREATE TABLE student_credits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id       text NOT NULL REFERENCES schools(location_id) ON DELETE CASCADE,
  student_profile_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  amount            numeric(12,2) NOT NULL,   -- + granted, − consumed
  reason            text NOT NULL,            -- 'discount_overflow' | 'applied_to_challan' | 'manual'
  source_challan_id uuid REFERENCES fee_challans(id) ON DELETE SET NULL,
  applied_challan_id uuid REFERENCES fee_challans(id) ON DELETE SET NULL,
  notes             text,
  created_by_uid    text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

Plus `student_credits_location_id_idx`, `student_credits_student_profile_id_idx`,
a CHECK constraining `reason` to those three values, and a CHECK that `amount`
is not zero.

**It is append-only, in the same sense the ledger is** — a correction is another
row, never an `UPDATE`. Say so in the schema docstring and do not add an
`updated_at`.

A student's balance is `SUM(amount)`. There is no balance column, for the same
reason `ledger_entries` has none.

### Where credits are created

Anywhere a discount would drive a line or a challan below zero:

* `concessionPaiseFor` already clamps a *line* to its own amount, and that stays
  — a single fee head cannot go negative.
* What is new is the **challan** floor. In `repriceOpenChallans`, when the
  recomputed total would fall below `paid_amount` (usually zero), the header is
  set to that floor and the surplus is written as a `discount_overflow` credit
  row with `source_challan_id` set.

### Where credits are consumed

`previewChallan` and `generateChallan` gain a final step, after
`summariseChallanItems`:

* read the student's outstanding credit balance;
* apply `min(balance, totalAmount)` as an **Adjustment** — a distinct line on
  the preview and on the printed challan, shown as a negative amount and labelled
  *Adjustment — credit carried forward*;
* on generation only, write the consuming `applied_to_challan` row (negative
  `amount`, `applied_challan_id` set) inside the same `batch()` as the challan.
  A credit consumed by a challan that was not written is a credit lost.

`totalAmount` after the adjustment is floored at zero. It cannot be negative
and the CHECK on the challan must continue to hold.

The adjustment is **not** a `fee_challan_items` row: those carry a
`fee_type_id`, and an adjustment has no fee head. Carry it on the header —
migration `0033` adds `fee_challans.credit_applied numeric(12,2) NOT NULL
DEFAULT '0'` — and render it from there. `total_amount` stays the authority on
what the parent owes: `subtotal − concession − credit_applied + late_fee`.

Update `lib/money.ts`'s callers accordingly; every sum stays integer paise.

### The screen

Add the balance to `StudentProfileCard`'s fee area and to the challan detail
page: *Credit carried forward: PKR 1,200* with a link to the challan that
created it. A credit nobody can see is a credit nobody trusts.

`npm run check-accounting` must stay green. This table is *not* the double-entry
ledger and must not be confused with it — it is a fee-module artefact, exactly
as outstanding balances are (see CLAUDE.md, "Income is recognised on receipt").
Say that in the docstring so the next reader does not try to make it balance.

---

## Item 10 — Guardian is a valid first guardian

`db/schema/student-guardians.ts` already has `guardian` in
`GUARDIAN_RELATIONSHIPS`. What excludes it is `FIRST_GUARDIAN_RELATIONSHIPS`:

```ts
export const FIRST_GUARDIAN_RELATIONSHIPS = ['father', 'mother', 'sibling'] as const;
```

Add `'guardian'`. Nothing else changes: `SINGLETON_RELATIONSHIPS` still holds
only father and mother — a child has one of each, but may have two guardians —
and `parseGuardians` reads the same constant the form does, so the server and
the dropdown cannot disagree.

Update the docstring above it. It currently argues that the first guardian is
the person the school holds responsible; a legal guardian *is* that person, and
the sentence should say so rather than being left contradicting the code.

---

## Item 11 — the student photo

Three separate defects, reported together.

### 11a — the selection survives going back to step 1

`StudentEnrollForm` holds `photo` in `useState<File | null>` on the parent, and
the steps are conditionally rendered — so the `<input type="file">` is unmounted
and remounted empty every time the wizard leaves and re-enters step 1. The
*state* survives; the input looks empty, which is why it was re-selected.

Fix it by rendering what is actually held rather than relying on the input:

* a **thumbnail preview** from `URL.createObjectURL(photo)`, revoked in a
  cleanup effect, beside the file name and size;
* a **Remove photo** button, which is the only thing that sets `photo` back to
  null;
* the `onChange` handler must **not** null the state when the dialog is
  cancelled:

  ```ts
  const file = event.target.files?.[0];
  if (file !== undefined) setPhoto(file);
  ```

  That last line is very likely the reported disappearance: cancelling a native
  file dialog fires `change` with an empty `FileList` on some platforms, and the
  current handler reads that as "the user removed the photo".

### 11b — the upload failure was invisible

The enrol form fires the upload and swallows everything:

```ts
await fetch(...);          // no `response.ok` check
} catch { console.warn(...) }
```

A 413, a 415 or a 500 is indistinguishable from success. *Student 5* on the live
tenant has `photo_url = null` and nobody was told.

Check `response.ok`, read `apiFailure`'s message, and carry the failure through
to the profile page the router pushes to — a query flag is enough
(`?photo=failed`) — so the profile renders a warning naming what went wrong and
offering the re-upload from 11c. The enrolment itself must still not be rolled
back; that judgement in the existing comment is correct.

**Storage is not the cause and does not need changing.** `uploadBuffer` in
`lib/storage.ts` already sends `x-upsert: true`, so a re-upload to the same
deterministic path replaces the object rather than being refused — checked
before this spec was written, so do not go looking there. The cancelled-dialog
handler in 11a is the explanation that fits the evidence, and the missing
`response.ok` check is why nobody was told.

### 11c — a photo can be changed from the profile

`StudentProfileCard` renders `photoUrl` and has an Edit mode for the text
fields, but nothing that touches the image. Add, behind `admissions.write`:

* **Change photo** / **Add photo** on the avatar, opening the same file input;
* an immediate `POST` to the existing
  `/api/school/students/[studentId]/photo` endpoint with a pending state;
* the error surfaced in the card, not the console;
* `router.refresh()` on success.

The endpoint already appends `?v=<timestamp>` to the stored URL (visible on the
live rows), so the browser cache is handled.

---

## Item 12 — the setup panel becomes per-KPI, and gains the fee structure

**Decided:** the headline is the **unweighted mean of every KPI's own
percentage**.

### The KPI list

`getSetupProgress` returns `SetupStep[]`, and each step grows `done`/`total`
alongside its existing `count`. `percent = round(100 * done / total)`, and
`done: boolean` becomes `complete: boolean` = `percent === 100`.

| KPI | `done` / `total` |
| --- | --- |
| **Principals** | branches with at least one **current** `principal_assignments` row / total branches — when `principal_model = 'multiple'`. When it is `'single'`, or the school has no branches: 1 if any active `principal`/`vice_principal` account exists, else 0, out of 1. |
| **Teachers & staff** | unchanged in substance — 1/1 once the existing combined count is `> 0`. Keep the staff-plus-unlinked-accounts query exactly as it is; QA earned it. |
| **Classes** | grades that have at least one active section / total grades. 0 grades ⇒ 0/1. |
| **Subjects** | 1/1 once `> 0`. |
| **Timetable** | sections with at least one active timetable entry / total active sections. |
| **Enrolled students** | 1/1 once `> 0`. |
| **one KPI per fee head** | grades priced under that head in the active academic year / total grades. |

That last row is the product owner's requirement stated exactly: *each fee in
the fee type structure should be its own KPI.* For LGS today that is Tuition
100%, Admission 100%, Annual 100%, Library 100%, **Examination 0%** — which is
the real state of that school and is invisible on the panel as it stands.

### An amount of 0 is complete; a missing row is not

Verbatim from the requirement: *if a fee does not need to be charged, then the
user to mark it as 0. Leaving it empty would mean that the KPI has not been
completed.* `fee_structures.amount` is `NOT NULL` with a `>= 0` CHECK, so this
is simply the existence of the row — count rows, do not filter on `amount > 0`.

`PUT /api/school/fees/structures` already draws this distinction correctly — a
blank cell deletes the row, a typed `0` stores `0.00`, and the comment there
says so. Checked before this spec was written. What is left to confirm is the
**client**: that the matrix component sends `0` and not `''` for a cell holding
zero, and that it re-renders a saved zero as `0` rather than as an empty box. A
zero that round-trips to blank would silently un-complete the KPI.

### The headline

```ts
percent = round(mean(steps.map(s => s.percent)))
```

`completed` becomes the count of steps at 100%, kept for the "4 of 11" line.

### The card

`SetupProgressCard` renders each step with its own small progress bar and
`n/m` beside the count, keeps the link while `percent < 100`, and groups the
fee-head KPIs under a **Fee structure** subheading so eleven rows still read as
six areas. The overall bar stays at the top.

A school with no fee heads at all shows one *Fee structure* row at 0/1 linking
to `/dashboard/fees/types` — after Item 3 that state only exists for schools
created before this deploy.

### `scripts/check-dashboard-queries.ts`

It runs `getSetupProgress` twice against a tenant that belongs to nobody and
both runs were green while the panel was wrong. Extend it to assert the
arithmetic — that every step's `percent` is `0..100`, that the headline is the
mean, and that a step with `total === 0` never divides by zero — and run it
against **LGS**, whose numbers are known and written down above.

---

## Acceptance

Each item is signed off only by the observable behaviour, in a browser, against
the live tenant:

1. Invite somebody; the mail in `email_outbox` carries `/set-password/`, not a code.
2. Sign in as *LGS Defence Principal*; the setup panel reads the same percentage
   the administrator sees, and the unassigned warning is visible.
3. Create a school in the Super Admin panel; its `fee_types` holds five rows.
4. A student's panel is headed *Admission fee* and is driven by the fee structure.
5. Remove the Admission Fee price for a grade; the panel goes red and offers the link.
6. Restore it; the panel offers the voucher and **not** the confirmation.
7. Generate it; the confirmation appears.
8. The sibling discount reaches the admission fee, and applying one afterwards
   reprices the open challan.
9. A discount larger than the fee floors the voucher at zero and the surplus
   appears on the next one as *Adjustment*.
10. *Guardian* is selectable as the first guardian and saves.
11. The wizard keeps the photo across steps, a failed upload says so, and the
    profile can change it.
12. The panel shows per-KPI bars including one per fee head, and LGS's
    Examination Fee reads 0%.
