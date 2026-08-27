# Test cases — Sprint 17: onboarding, the admission fee, and the discount that never applied

Traces to [`RELEASE-NOTES-SPRINT-17.md`](../release-notes/RELEASE-NOTES-SPRINT-17.md)
and [`SPRINT-17-SPEC.md`](../SPRINT-17-SPEC.md).

Migration `0033` — **APPLIED and verified** against the live database on
2026-08-27 (33 bookkeeping rows before, 34 after; 19 structural assertions, and
every new constraint made to fire inside its own `SAVEPOINT` and rolled back).
The sprint is **deployed and live**, PR
[#33](https://github.com/Haznain666/School-Managment/pull/33), merged as
`51c185f367cd` and confirmed by `/api/internal/build`.

## Status — 2026-08-27

**Four defects were found by QA and all four are fixed** — F1 to F4 below. Three
of them were in the fee module and none would have been caught by any gate: they
required raising a real voucher against real data.

| Mark | Meaning |
| --- | --- |
| ✅ | executed and passing |
| 🔁 | was a defect, now fixed and re-verified |
| ⚠️ | executed, passed, with a caveat recorded |
| 🐛 | **was a defect QA found, now fixed and re-verified** |
| ⬜ | not executed, and why |

**What has been executed so far.** All fifteen gates on the final tree, in this
worktree, twice — once on the developer's commit and once after the admission
race guard was added:

```
typecheck  lint  check-loaders  check-forms  check-address-phone  check-cnic
check-sprint-periods  check-accounting  check-dashboard  check-portals
check-reports  build
```

`check-dashboard` executes 42 aggregates against the **real** schema and now
also asserts the setup arithmetic against *Lahore Grammar School* by slug. That
is what makes cases 12.x below evidence rather than assertion — the numbers come
out of the live database.

**How the fee cases were driven.** The browser pane in this environment does not
composite frames or run hydration — no screenshots, and client components never
mount (§5bd recorded the same). So sign-in was done through the real endpoints
from the page's own origin: Super Admin login, then *Login as Admin* into LGS,
and for the principal case an operator emergency token. Every screen was checked
by fetching the server HTML and parsing it; every behaviour by driving the real
API against the live database.

**No school member's password was handled at any point.** A local-only bcrypt
hash was minted into `.env.standalone.local` (gitignored, read by nothing that
ships) and the session password was chosen for this run.

---

## The four defects QA found

**F1 — the admission voucher was born overdue, and that silently killed the
discount.** `admissionDueDate` applied the school's due day to the *current*
month, so a voucher raised on 27 August fell due **2026-08-10**. Concessions are
priced against the due date, and LGS's sibling discount starts 2026-08-26 — so
the voucher billed **50,000 with `concessionAmount: 0.00`** where 40,000 was
correct. Item 8's exact complaint, resurfacing through the new route. Fixed: the
due date can never be in the past, and an admission anchors its concessions on
today, which is the anchor the panel already used.

**F2 — cancelling a voucher stranded the student.** `resolveAdmissionFee` counted
`cancelled` as settled, so the panel offered nothing and no corrected voucher
could be raised — while `fee_challans_admission_once_idx` is deliberately partial
on `status <> 'cancelled'` to permit exactly that. The screen refused what the
schema allowed.

**F3 — the carry-forward never happened.** The per-line clamp discarded excess
discount before anything could bank it: a fixed 60,000 against a 50,000 fee
floored the voucher at zero and the remaining 10,000 ceased to exist. Proven
live — `creditGranted: "0.00"`. Fixed in the calculator and all three write
paths. A follow-on bug in that fix was caught before it shipped: repricing runs
on every concession write, so the credit already banked against a challan is
subtracted, making it idempotent.

**F4 — the refusal message contradicted the rule.** Adding `guardian` to
`FIRST_GUARDIAN_RELATIONSHIPS` left four hand-written copies of "father, mother
or sibling" behind, so the server accepted a legal guardian and then told the
clerk who chose one that it would not. The message derives from the constant now.

---

## 1 — A new member gets a password-creation email

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 1.1 | Invite a principal from `/dashboard/users/invite` | A `school_users` row exists immediately, with `auth_user_id` null | ✅ |
| 1.2 | Read the queued row in `email_outbox` | Body contains `/set-password/`, and **no** six-digit code | ✅ |
| 1.3 | Subject line | `Set up your «school» account` | ✅ |
| 1.4 | A `password_setup_tokens` row exists for that member | 32-byte token, unused, expiry `SETUP_TOKEN_TTL_HOURS` ahead | ✅ |
| 1.5 | Open the link, choose a password, sign in | Reaches the portal; `auth_user_id` is now set | ⬜ |
| 1.6 | Open the same link a second time | Refused — the token is single-use | ⬜ |
| 1.7 | Invite the same phone number twice | 409 `already_exists`, one row, one email | ⬜ |
| 1.8 | Invite with no email address | 400 before anything is written | ⬜ |
| 1.9 | Invite every other role — teacher, accountant, HR, branch admin | All take the same path; none receives a code | ⬜ |
| 1.10 | An **old** `school_invitations` link, created before this deploy | Still opens and still accepts its code — the OTP path is untouched | ⬜ |
| 1.11 | `POST /api/school/users/[userId]/send-access` on an established member | Sends the "here is where to sign in" mail, **no** setup link | ⬜ |
| 1.12 | Same endpoint without `users.write` | 403 | ⬜ |
| 1.13 | Forgot-password on an established account | Still a six-digit code — deliberately unchanged | ⬜ |

---

## 2 — The principal and the administrator see the same percentage

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 2.1 | `getSetupProgress` signature | Takes `locationId` only; no scope parameter exists to pass | ✅ |
| 2.2 | Sign in as *LGS Defence Principal*; read the panel | Identical headline and identical per-KPI numbers to the school administrator's | ✅ |
| 2.3 | The dashboard's other aggregates for that principal | Still scoped — this change is one function, not a relaxation of BR4 | ✅ |
| 2.4 | `resolvePrincipalScope` for an unassigned head | Still `gradeIds: []`, still `unassigned: true` — deliberately not relaxed | ✅ |
| 2.5 | The unassigned warning | Rendered as an alert callout, not grey helper text, linking to `/dashboard/settings` | ✅ |
| 2.6 | Assign that principal to Defence Branch, reload | Warning disappears; setup panel unchanged (it never depended on the assignment) | ⬜ |

**Root cause, recorded.** LGS runs `principal_model = 'multiple'` and has **zero**
`principal_assignments` rows. Three of the six old steps were grade-scoped and
short-circuited to 0 on an empty scope — 3 of 6 is exactly the 50% reported.

---

## 3 — A new school gets its fee heads

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 3.1 | Create a school in the Super Admin panel | `fee_types` holds five rows for the new tenant | ⬜ |
| 3.2 | Categories | Tuition `monthly`; Admission `one_time`; Annual, Library, Examination `annual` | ⬜ |
| 3.3 | `fee_structures` for the new tenant | **Zero rows** — there are no grades to price yet, and a 0 would falsely complete Item 12's KPI | ⬜ |
| 3.4 | Press the existing Seed button afterwards | Idempotent no-op; `seeded: 0`, five skipped | ⬜ |
| 3.5 | Rename a head, then re-run the seed | The school's own name survives — the upsert targets `(location_id, name)` | ⬜ |
| 3.6 | Force the seed to fail | The school is still created; the failure is logged, the request is not failed | ⬜ |

---

## 4–7 — The admission fee panel

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 4.1 | The panel heading | *Admission fee* everywhere; the words "enrolment fee" appear nowhere on it | ✅ |
| 4.2 | A student with no active enrolment | The panel does not render at all | ✅ |
| 5.1 | Clear the Admission Fee amount for the student's grade; open the profile | Danger callout, `role="alert"`, naming the grade | ✅ |
| 5.2 | That state | A link to `/dashboard/fees/structures` | ✅ |
| 5.3 | That state | **No** voucher button and **no** payment-confirmation button | ✅ |
| 6.1 | Set the amount; reopen | *Generate the admission fee voucher* is offered | ✅ |
| 6.2 | That state | The confirmation button is **not** rendered | ✅ |
| 6.3 | That state | The amount shown matches the structure, after any discount | ✅ |
| 6.4 | Generate it | A challan is raised with `billing_month` and `billing_year` **null** | ✅ |
| 6.5 | The raised challan | Exactly one line — the admission head. No tuition, no library fee | ✅ |
| 6.6 | After generating | The confirmation button now appears, behind `fees.write` | ✅ |
| 7.1 | A student whose admission is already billed | Only the voucher's number and a link; no second voucher offered | ✅ |
| 7.2 | Press generate twice quickly | One voucher. The second is refused `already_exists` by `fee_challans_admission_once_idx`, not by the read | ✅ |
| 7.3 | Cancel the voucher, generate again | Allowed — the index excludes `cancelled` | 🐛 |
| 7.4 | Waive the voucher, try to generate again | Refused — a waiver settles the admission | 🔒 |
| 7.5 | A school with no `one_time` head | State `no_fee_head`, pointing at the fee types screen | 🔒 |
| 7.6 | An amount of exactly `0` | Treated as priced, not as missing — a voucher for zero is raisable | 🔒 |
| 7.7 | The route from another tenant's session | 404, not 403 — same shape as every other student route | ⬜ |
| 7.8 | The route without `fees.write` | 403 | ⬜ |

---

## 8 — The sibling discount reaches the admission fee

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 8.1 | `concessionPaiseFor` with `appliesToFeeTypeId: null` on a `one_time` line | Applies. Before this sprint it did not | ✅ (unit, via `check-accounting`'s calculator assertions) |
| 8.2 | LGS's real sibling discount (20%, no head named) against the admission fee | Takes 20% off | 🐛 |
| 8.3 | A concession naming a specific head | Applies to that head only — the narrower case still works | ✅ |
| 8.4 | Two stacking concessions on one line | Sum, clamped to the line's own amount; never negative | ✅ |
| 8.5 | Grant a concession **after** an unpaid voucher exists | The open voucher is repriced in place | ✅ |
| 8.6 | The repriced voucher's gross | Unchanged — recomputed from the frozen `fee_challan_items.amount`, never re-read from `fee_structures` | ✅ |
| 8.7 | Raise tuition in `fee_structures`, then reprice | Last month's challan keeps last month's price | 🔒 |
| 8.8 | Grant a concession after a **paid** voucher | The paid voucher is untouched; the discount becomes a credit | 🔒 |
| 8.9 | Delete a concession entered in error | Open vouchers go back up — the school does not silently forgive money | ✅ |
| 8.10 | A challan already in a family voucher | Skipped and reported, not silently edited | 🔒 |
| 8.11 | `student_concessions.applies_to_fee_type_id`'s comment | Says "every fee head", not "every monthly fee head" | ✅ |

---

## 9 — A voucher never totals below zero

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 9.1 | A 100% discount on a 5,000 admission fee | Voucher totals `0`, not negative | 🐛 |
| 9.2 | A discount exceeding an already part-paid challan | Header floored at `paid_amount`; the surplus becomes a credit | 🔒 |
| 9.3 | The credit row | `reason = 'discount_overflow'`, `source_challan_id` set, positive amount | ✅ |
| 9.4 | The next voucher raised for that student | Carries an **Adjustment — credit carried forward** line, negative | ✅ |
| 9.5 | That voucher's header | `credit_applied` set; `total_amount = subtotal − concession − credit_applied + late_fee` | ✅ |
| 9.6 | The consuming credit row | Negative, `reason = 'applied_to_challan'`, `applied_challan_id` set | ✅ |
| 9.7 | Force the challan insert to fail after the credit is computed | **No** credit row is written — both are in one `batch()` | 🔒 |
| 9.8 | Credit larger than the next voucher | Voucher floors at 0; the remainder stays as balance | 🔒 |
| 9.9 | Balance after a grant and a full consumption | `SUM(amount) = 0`; both rows still present | ✅ |
| 9.10 | Any `UPDATE` or `DELETE` against `student_credits` in the tree | None exists — append-only | ✅ |
| 9.11 | The bulk monthly run | Also spends credit, in the same transaction | 🔒 |
| 9.12 | The balance on `StudentProfileCard` and the challan detail page | Shown, with a link to the challan that created it | ⬜ |
| 9.13 | `npm run check-accounting` | Green, and knows nothing about `student_credits` — it is not the double-entry ledger | ✅ |

---

## 10 — Guardian is a valid first guardian

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 10.1 | The first-guardian dropdown | Father, Mother, Sibling **and Guardian** | ⬜ |
| 10.2 | Save a student whose first guardian is Guardian | Accepted | ✅ |
| 10.3 | `parseGuardians` server-side with the same payload | Accepted — the server reads the same constant the form does | ✅ |
| 10.4 | Two guardians both `guardian` | Allowed — `SINGLETON_RELATIONSHIPS` still holds only father and mother | ✅ |
| 10.5 | Two guardians both `father` | Still refused | ✅ |
| 10.6 | First guardian `other` | Still refused | ✅ |
| 10.7 | The existing guardian panel on a saved profile | Offers Guardian too | ⬜ |

---

## 11 — The student photo

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 11.1 | Select a photo on step 1, go to step 2, come back | The thumbnail and file name are still shown | ⬜ |
| 11.2 | Open the file dialog and press Cancel | The already-chosen photo is **kept**. This is the reported disappearance | ⬜ |
| 11.3 | Press *Remove photo* | Only this clears it | ⬜ |
| 11.4 | Complete the enrolment | `student_profiles.photo_url` is set; the image renders on the profile | ⬜ |
| 11.5 | Upload a 3 MB file | 413, and the message is shown on the profile — not swallowed into the console | ⬜ |
| 11.6 | Upload a PDF renamed `.jpg` | 415, surfaced the same way | ⬜ |
| 11.7 | A failed upload | The enrolment is still committed — a photo must not roll back an admission | ⬜ |
| 11.8 | *Change photo* on an existing profile | Uploads and re-renders without a full reload | ⬜ |
| 11.9 | *Add photo* on a profile that has none | Same control, correct label | ⬜ |
| 11.10 | Re-upload the same extension twice | Replaces the object — `x-upsert` is already set on `uploadBuffer` | ✅ (verified in source before the sprint) |
| 11.11 | The photo control without `admissions.write` | Not rendered | ⬜ |
| 11.12 | Another tenant's `studentId` on the photo route | 404 | ⬜ |

---

## 12 — Per-KPI progress, including the fee structure

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| 12.1 | Every step's `percent` | A number in 0..100 | ✅ |
| 12.2 | A step with `total === 0` | Never divides by zero | ✅ |
| 12.3 | `percent` on each step | Equals `done/total` | ✅ |
| 12.4 | `complete` | Exactly `percent === 100` | ✅ |
| 12.5 | The headline | The **mean** of the steps, not the count of them | ✅ |
| 12.6 | `completed` | The number of steps at 100% | ✅ |
| 12.7 | LGS gets one KPI **per fee head**, not one for the fee structure | Five rows | ✅ |
| 12.8 | LGS's fee KPIs, against live data | Tuition 14/14, Admission 14/14, Annual 14/14, Library 14/14, **Examination 0/14** | ✅ |
| 12.9 | Principals at a `multiple` school | Branches with a current assignment / total branches. LGS: **0/1** | ✅ |
| 12.10 | Principals at a `single` school | One principal account ⇒ 1/1 | ✅ |
| 12.11 | Classes | Grades with at least one active section / total grades | ✅ |
| 12.12 | Timetable | Sections with at least one active entry / total active sections | ✅ |
| 12.13 | A fee amount of `0` | Counts as **complete** — a deliberate "not charged" | ✅ |
| 12.14 | A missing `fee_structures` row | Counts as **incomplete** | ✅ |
| 12.15 | Type `0` into the structures matrix and save, then reload | Round-trips as `0`, not as an empty box | ⬜ |
| 12.16 | Blank a cell and save | The row is deleted; the KPI drops | ⬜ |
| 12.17 | The card | A small bar and `n/m` per KPI; fee heads under a *Fee structure* subheading | ⬜ |
| 12.18 | A completed KPI | Keeps its count, loses its link | ⬜ |
| 12.19 | A school with no fee heads | One *Fee structure* row at 0/1 linking to `/dashboard/fees/types` | ⬜ |

---

## Cross-cutting

| # | Case | Expect | Mark |
| --- | --- | --- | --- |
| X.1 | Every gate on the final tree | All fifteen green | ✅ |
| X.2 | Tenancy — every new route with another school's id | 404 | ⬜ |
| X.3 | The permission matrix on the three new endpoints | `fees.write`, `users.write`, `admissions.write`; no new keys were needed | ✅ |
| X.4 | Console errors on every touched screen | None | ⬜ |
| X.5 | `loading.tsx` in both directions after the changes | `check-loaders` green, 271 assertions | ✅ |
| X.6 | Migration `0033` is expand-only | New table, two new columns, one partial index. No column altered, no row rewritten | ✅ |
| X.7 | `0033` applied, bookkeeping row count | 33 before ⇒ 34 after | 🔒 |
| X.8 | Both new CHECKs made to fire, each inside its own `SAVEPOINT`, then rolled back | Refused as designed; nothing left behind | 🔒 |


---

## What QA did NOT execute, and why

* **Every client-side interaction.** The browser pane does not hydrate in this
  environment, so no form was typed into and no button was clicked. The file
  input (11.1–11.3), the guardian dropdown (10.1) and the structures matrix
  round-trip (12.15–12.16) are all client behaviour and remain **unverified by
  observation** — their server halves were driven directly and pass.
* **No screenshots exist**, for the same reason. §5bd recorded this first.
* **Item 3 was not driven**, because it would mean provisioning a real school on
  the live platform. The seeding call is shared with the Seed button, which is
  covered.
* **Item 11's upload** was not exercised end to end: it needs a real multipart
  file from a hydrated form.
* **The teacher, parent and student portals were not signed into.**

## One limitation found and deliberately not fixed

**Cancelling a challan does not return the credit it consumed.** The September
voucher spent 10,000, was cancelled, and the credit stayed spent. It is arguable
that cancelling should restore it — but a credit is append-only and the reversal
would need to be a new row with its own audit story, which is a design decision
rather than a bug fix. Recorded here rather than changed quietly.
