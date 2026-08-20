# Sprint 13.8 — siblings become a thing the system knows

**Merged 2026-08-20.** Migration `0026_sibling_identity.sql` applied to the live
database and verified against the real schema.

> ✅ **Live since 2026-08-20.** Verified by the build id served at
> `/super-admin/login` changing across the deploy, by the homepage rendering the
> real platform domain rather than the `platform.com` fallback, and by
> `/api/school/guardians/lookup` answering `401` on a real school host while a
> nonsense path answers `404`. The deploy pipeline that had to be repaired to get
> it there is written up in
> [its own notes](RELEASE-NOTES-ANNOUNCEMENT-SWEEP-AND-DEPLOY.md).

---

## The problem, stated exactly

Nothing in this product linked one student to another.

"Sibling" was derived in **one** place — `lib/family-challans.ts` — by grouping
open fee challans on the primary guardian's **phone number**. It was derived
nowhere else. So:

* the only screen in the entire system that knew two children were related was
  **Fees → Family Vouchers**, and only for children with an open challan in the
  month being billed;
* a school admin looking at Ahmed's profile had no way to see that Fatima two
  classes up is his sister;
* an admissions clerk enrolling a second child re-typed the father from scratch,
  and any difference in spelling — `0300` written `+92300`, a middle name
  included this time — created a **second person**, after which the two children
  were related in the database by nothing at all;
* a parent with three children switched between them with a row of pills that
  appeared on six screens and was missing from the rest;
* Super Admin had no sibling surface at all, and still has none — a platform
  operator has no business reading a family's composition.

Phone was always the wrong key. It is a household's number, not a person's: two
unrelated guardians on one handset read as one family, and a couple who each
gave a different number read as two.

---

## What changed

### 1. The CNIC is now an identity key

`student_guardians.cnic` stops being a note somebody may or may not have filled
in. **Two enrolled students are siblings when they share a guardian, and two
guardian rows are the same person when they share a CNIC *or* a phone number.**

The rule lives in one file, `lib/siblings.ts`, and every screen reads it from
there.

**Why both keys, and not CNIC alone.** Promoting CNIC over phone would have
*split* families rather than merged them: a father recorded with his CNIC on his
new child and without it on the elder one — which is every family already on a
roll, plus one new admission — would have come out as two guardians and two
vouchers. A regression shipped as an improvement. The two keys are therefore
unioned, transitively: `lib/family-challans.ts` now runs a union-find over the
guardian rows, so the CNIC on the new row and the phone on the old row link the
two halves of that father into one family.

It stays fallible in the one way it always was — two unrelated guardians sharing
a handset are read as one family. That is rare, and it is **visible**: the
sibling card names the children and the guardian they are shared through, and
the voucher prints them. Every CNIC collected makes it rarer.

### 2. The enrolment form asks for the CNIC first

On the guardian step, the CNIC moved from fifth field to first, spanning the
card. A complete number is looked up against every guardian at the school
(`GET /api/school/guardians/lookup`), and when it matches:

* the card **fills itself in** from the record the school already holds — name,
  phone, email, occupation — never overwriting anything the clerk has typed;
* it says, by **name and admission number**, which children this person is
  already the guardian of.

That is the whole feature. The children become siblings not because anything is
written to link them, but because the new guardian row carries the same identity.

The same lookup runs on the **Add guardian** panel of a student's profile, and
on mount for a converted application — the case most likely to be a returning
family, where the clerk never touches the field so a keystroke-triggered lookup
would never fire.

### 3. Three guardian rules

Enforced on the form **and** in `parseGuardians` — the dropdown is a courtesy,
the server is the rule:

| Rule | Why |
| --- | --- |
| The first guardian must be **Father, Mother or Sibling** | "Other" is the absence of an answer to "who does the school hold responsible for this child" |
| **Father** and **Mother** are each available once per student | a second row claiming either is a duplicate, and a duplicate splits one family in two on the sibling lookup and the family voucher |
| **"Other" carries a written relation** — a new `relationship_other` column | "Other" alone tells a teacher ringing the number nothing |

The taken options disappear from the dropdown rather than being refused after
the fact. `availableRelationships` is shared between the enrolment form and the
guardian panel so the two screens cannot disagree.

**One documented exception:** `POST /api/school/applications/[id]/convert`
carries what the *applicant* wrote on the public form weeks ago. A one-click
conversion must not fail because a parent described themselves as a guardian
rather than as a father; the relationship is corrected on the profile in one
click, and refusing would lose the admission instead.

### 4. Siblings are shown on five surfaces

| Who | Where | What they see |
| --- | --- | --- |
| **School Admin / Branch Admin** | student profile | **Siblings at this school** — name, admission number, class, and which guardian they are shared through. Withdrawn siblings appear with a badge, because an elder brother who left is why the school's records mention this family twice. |
| **School Admin / Branch Admin** | application review | **This family is already at this school** — before the offer goes out, which is the only moment it can change the decision (sibling discount, admission test waiver, campus placement). |
| **School Admin / Branch Admin** | challan detail | the family, with a pointer to Family Vouchers. Answers the question asked at the counter: "is this everything, or is there another slip for my other child?" |
| **School Admin / Branch Admin** | enrolment + Add guardian | the live CNIC lookup, above |
| **Parents / Guardians** | **portal header, every screen** | a dropdown naming every child on this login. Selecting one re-reads the page for that child. |
| **Super Admin** | — | nothing, deliberately |

### 5. The parent portal header switcher

Which child a parent is reading is the single most important piece of state in
that portal, and it lived in a row of pills below the fold on a phone, absent
from the screens that do not take `?child=`.

It is now in the header on every parent screen: `ChildSwitcher`, a native
`<select>` — the one menu that is already keyboard-navigable, screen-reader
announced, and rendered by the phone as a full-height picker. One child renders
as plain text, because a dropdown offering a single option is a control that
cannot be used.

**It is not an authorisation boundary and never was.** `?child=` selects among
children the parent's own query returned; every parent page re-checks the id and
falls back to their first child. The header reads the parent's children through
`student_guardians.school_user_id` — the account link — and *not* through the
sibling rule, because widening a portal's reach to "anyone sharing my phone
number" is a much worse mistake than a voucher grouping two families.

### 6. Every guardian can be invited

Already true, now stated on the form: any guardian with an email address gets
their own portal account, and one account shows every child that guardian is
recorded against.

---

## The standing rule this leaves behind

**Every CNIC field in this product is `components/ui/CnicField.tsx`, and every
stored CNIC goes through `normalizeCnic` first.**

There were four raw `<Input label="CNIC">` boxes — the enrolment guardian step,
the guardian panel, the public application form and the staff record — and only
the *student's* own document had a mask, a reveal and validation. All four now
use the same field the enrolment screen has always used for the student.

This is not a formatting preference. A column holding `4210112345671` on one row
and `42101-1234567-1` on another holds **two different people** as far as every
query is concerned, and the two are indistinguishable on screen because both
render as a masked field. An unmasked input does not produce an ugly value; it
produces a family that silently stops being a family.

Enforced by **`npm run check-cnic`** — 36 assertions across the mask,
canonicalisation, masking and a source scan of all 396 components — added to
`.github/workflows/ci.yml` so it runs on every push. Written for the same reason
`check-address-phone` was: the requirement was explicit that it applies to *all
future development*, and only a check answers that half.

`CLAUDE.md` carries both new rules.

---

## The migration, and what it deliberately did not do

`0026_sibling_identity.sql`:

1. `relationship_other` added, nullable, **without** a CHECK tying it to
   `relationship`. Rows written before today are legitimate history and a
   constraint would refuse the next unrelated write to any of them.
2. Two indexes: `(location_id, cnic)` and `(location_id, phone)` — the two entry
   points of the sibling lookup, both on screens a clerk is waiting on.
3. **The back-fill.** Every value carrying exactly thirteen digits was rewritten
   to `42101-1234567-1`. Anything else — eleven digits, a passport number typed
   in the wrong box — was **left exactly as it was**.

That last point is the important one. Guessing at a malformed identity number is
how you invent a relationship between two children who are not related, and this
migration must not be capable of it. Those rows simply do not participate in
CNIC matching: `lib/siblings.ts` re-normalises on read and drops what it cannot
canonicalise, so a partial number can never match another partial number by
string equality.

Empty strings were cleared to null for the same reason — as an identity key, `''`
would match every other guardian who left the field blank.

### Verified against the live database, not against the exit code

27 of 27 migrations recorded; `relationship_other` present; both indexes
present; **both** thirteen-digit rows canonicalised; **zero** left in a
non-canonical spelling; zero empty strings; and the one 32-character junk value
found in production — proof of what an unmasked field produces — left at exactly
32 characters rather than truncated into a plausible CNIC. The sibling rule then
found the family those two rows describe.

---

## Green build

`typecheck`, `lint`, `check-loaders`, `check-forms`, `check-address-phone`,
`check-cnic`, `check-sprint-periods`, `check-theme`, `build` — all pass.
