# Sprint 22 test cases — one person, one record

Run 2026-09-01 against `26e80c8` on a local `next dev`, signed in through Super
Admin → Login as Admin at Lahore Grammar School (`21fad594…`) and Beacon House
(`e00506c5…`). Every row below was driven in a browser unless it says otherwise.
All test data was removed and the removal read back — see §Cleanup.

The Browser pane composited normally this run. Screenshots were occasionally a
frame stale, so content was read with `read_page` / `get_page_text` and every
write was cross-checked against Postgres rather than against the screen alone.

| # | Case | Expected | Result |
| --- | --- | --- | --- |
| 1 | HR → Add staff member, **No login needed** (default) | one request, no new required field | PASS — only `POST /api/school/hr/staff`; `portalAccess: null` |
| 2 | HR → Add staff member, **Create a login** | one `staff` + one `school_users`, joined | PASS — `QA22-B` ↔ `50770a23…`; outbox row `sent` |
| 2b | …the form states whether the mail was queued | a sentence either way | PARTIAL — silent on success, warns only when not queued. See §Observations |
| 3 | Invite Staff, box **on** | both rows, joined; code pre-filled | PASS — `QA22-E` ↔ `8e3326b2…`; `next-code` → `EMP-001` |
| 4 | Invite Staff, box **off** | exactly as before | PASS — fields leave the DOM; account only |
| 5 | Staff profile → Link an existing account | column set, badge clears on BOTH screens | PASS |
| 6 | Staff profile → Unlink | column cleared, badges return on BOTH screens | PASS |
| 7 | HR `?linked=none` | exactly the split records | PASS — 3 of 6, all badged |
| 7b | HR **Has a login** | only records that have one | **FAIL → FIXED** — a resigned unlinked record was listed. See defect 2 |
| 7c | Users & Staff `employment=none` | exactly the split records | PASS — `total: 5`, identical to the badged set |
| 8 | Invite on a colleague's address | refusal names the ADDRESS | PASS — 409, names Hina QaInvited; the phone sentence never appeared |
| 8b | Invite on a taken phone | refusal names the phone | PASS — the §6 fix did not swallow it |
| 9 | Two staff rows, one account | refused | PASS — names the claiming employee code |
| 10 | HR partial failure (taken phone) | staff row SURVIVES, message says so | PASS |
| 11 | Invite partial failure (duplicate code) | account SURVIVES, message says so | PASS |
| 12 | Tenancy: link a foreign account | refused | PASS — 400, "That portal account does not exist." |
| 13 | Tenancy: POST/DELETE portal-access on a foreign staff id | refused | PASS — 404 both |
| 14 | Tenancy: `/portal-accounts`, `/next-code` | own tenant only | PASS — 6 at LGS, 2 at Beacon |
| 15 | Badge consequence, class teacher | "cannot be assigned periods…" | PASS |
| 16 | Badge consequence, teacher account | "cannot be made a class teacher…" | PASS |
| 17 | Resigned staff, no login | NOT badged | PASS |
| 18 | User profile → Add an employment record | record created and linked | PASS for two-word names |
| 18b | …for a one-word name ("Sikandar") | record created and linked | **FAIL → FIXED** — 400 "Enter the first and last name." See defect 1 |
| 19 | Permission split, server-side | 403 for the missing key | NOT EXERCISED — see §Not proven |
| 20 | `check-loaders` | pass | PASS — 279 assertions |
| 21 | `check-sprint22` | pass | PASS — 17 ok, 0 failed |
| 22 | Console / network on every screen | clean | PASS — no JS errors, no 5xx across the whole run |
| 23 | Responsive 375×812 | fieldset stacks, nothing clipped | PASS |

## The two defects, and their fixes

**1. "Add an employment record" was a dead end for one-word names.**
`app/api/school/hr/staff/route.ts` refused `lastName === ''`, but
`splitPersonName` leaves the surname empty for a one-word name *on purpose* —
a great many people in Pakistan are recorded under one. So a member called
"Sikandar" was badged *No employment record* and then refused by the very button
that badge points at, with a sentence naming two fields the screen does not
show. The same person filed without complaint through Invite Staff, which
inserts the identical split straight into `staff` and never had the guard.

Fixed: the route refuses only a blank `firstName`. The HR form is unaffected —
`StaffManager` still requires both fields in the browser, which is the right
place to ask a clerk typing a record from scratch for a surname.

**2. "Has a login" listed staff with no login.**
`components/hr/StaffManager.tsx` computed the filter as
`row.status === 'active' && row.schoolUserId === null ? 'none' : 'linked'` — the
boolean complement of an *active-only* predicate. A resigned, unlinked record
fell through to `'linked'`. Confirmed in the browser: Zara QaDriver,
`school_user_id` null, Resigned, appeared under *Has a login*.

Fixed: the two filters are answered independently, and a record that is neither
returns `null`, which `matchesFilter` treats as matching nothing
(`components/ui/DataTable.tsx:341`).

Both defects were in the reconciliation surface this sprint added. Nothing in
the sprint's core contract was broken.

## Partial-failure ordering — both directions

The thing sprints of this shape break. Both correct.

- **HR path, taken phone** — `201` with
  `{"staffId":"ea2ef8d0…","portalAccess":{"linked":false,"problem":"Someone with that phone number already exists at this school."}}`.
  The staff row survived; the form said *"Nadia QaClash was added to the
  payroll, but no login was created. … You can link or create one from their
  profile."* No orphan `school_users` row.
- **HR path, colleague's address** — staff row survived, message named **Bilal
  QaTeacher** and the address.
- **Invite path, duplicate employee code** — the account survived, message
  *"Duplicate Address QaTest was invited. Employee code "QA22-E" is already in
  use at your school, so no employment record was added. The invitation was
  still sent."*

## Tenancy — attacked from both sides, all refused

From LGS: linking a Beacon `school_users` id → 400 *"That portal account does
not exist."*; a legacy `schoolUserId` on `POST /hr/staff` → the same, and no
staff row written. From Beacon: `POST` and `DELETE …/{lgsStaffId}/portal-access`
→ 404; `GET /hr/staff/{lgsStaffId}` → 404. `location_id` comes from the session
on every new path.

## Not proven, and why

- **Acceptance criterion 9's permission split was verified by code, not by
  session.** No default role holds `hr.write` without `users.write` or the
  reverse — `school_admin` and `hr_manager` hold both — so the split is only
  reachable through a per-school override, and writing one was blocked. What
  *was* verified: all four keys already exist in `PERMISSIONS` and
  `DEFAULT_ROLE_PERMISSIONS` (no new keys were needed); every new route calls
  `hasPermission` for the crossing key server-side — `portal-access` POST
  `users.write`/`users.read`, `portal-accounts` `users.read`, `/hr/staff` POST
  `users.write`, `/invitations` `hr.write` **before** the account is written;
  and all four pages compute their component flags from the same `permissions`
  array. The wiring is right; nobody has run it as a restricted role.
- **`{queued:false}` was never forced.** SMTP is configured locally, so every
  send queued. The plumbing is proven through the sibling
  `portalAccess.linked === false` warning, which rendered in the browser through
  the same `setWarning`, but the "no password-setup email was queued" sentence
  itself was never displayed.
- **Dark mode is not applicable** — the portal renders its school-branded theme
  regardless of `prefers-color-scheme`.

## Observations, not defects

- On the happy path **none of the three forms says the mail was queued** — they
  speak only when it was not. This matches `InviteForm`'s pre-existing
  behaviour, which §1 of the spec names as the model, so it is read as
  deliberate. A product decision, not a fix.
- `GET /api/school/hr/staff/[staffId]` returns the linked account's `name`,
  `role` and `branchName` under an `hr.read` gate, while `/portal-accounts`
  guards the same class of data behind `users.read`. One person's row, whose
  name the staff record already holds. Low.
- The HR API has no module gate: a `staff` row was created at Beacon House with
  **HR & Payroll switched off** (the page itself correctly said "not enabled").
  Pre-existing across the module, not a Sprint 22 regression.
- `school_users.phone` is stored in display form `(0321) 990-0011` by these
  paths while provisioned rows hold `+923…`. Pre-existing — `HEAD~1`'s
  invitations route did the same.

## Cleanup

`staff` is back to one row platform-wide (`QA14-T1`, active, unlinked);
`school_users` back to 13 / 1 / 2 by school; `email_outbox` and
`password_setup_tokens` entries for the test addresses removed; the residue
query returns `users 0, staff_rows 0, outbox 0, orphan_tokens 0`. `.env.local`
restored byte-identical — the QA `SUPER_ADMIN_PASSWORD_HASH_B64` line is gone.
