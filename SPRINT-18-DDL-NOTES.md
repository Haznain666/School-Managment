# Sprint 18 — DDL owed to migration `0034`

A scratch file, not a migration. Everything below is what the code on this
branch **needs the database to say**, written out so a single `0034` can be
folded together at the end of the sprint rather than accumulating four
migrations that all touch the same constraint.

Nothing here has been applied. `npm run db:migrate` is `sprint-devops`'s.

---

## From phase 1 (items 1–5, 15, 16)

### The permission CHECK has to widen, or every new key is unwritable

`lib/permissions.ts` gained four keys — `students.read`, `students.create`,
`students.update`, `students.delete` — and `db/schema/role-permissions.ts`
derives its CHECK from that array, so the schema file is already correct. The
**live constraint is not**: it still lists the Sprint 13.5 set, and an
administrator toggling any of the four on the permissions screen would be
refused by Postgres with a constraint name and no explanation.

The defaults do not need it. `DEFAULT_ROLE_PERMISSIONS` is code, and a school
with no override row gets the new keys with no write at all — which is the whole
design of that table and why this deploys safely ahead of the migration. What
needs it is the first school that changes one.

```sql
ALTER TABLE role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_permission_check;

ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_permission_check CHECK (
    permission IN (
      'users.read', 'users.write',
      'admissions.read', 'admissions.write',
      'students.read', 'students.create', 'students.update', 'students.delete',
      'students.import', 'students.promote', 'students.transfer',
      'fees.read', 'fees.write',
      'academics.read', 'academics.write', 'attendance.mark',
      'exams.read', 'exams.write', 'exams.publish',
      'results.enter', 'results.publish', 'results.promotion',
      'hr.read', 'hr.write',
      'payroll.read', 'payroll.write',
      'comms.read', 'comms.write', 'comms.send',
      'settings.read', 'settings.write',
      'principals.manage', 'permissions.manage',
      'accounting.read', 'accounting.write', 'accounting.settle'
    )
  );
```

⚠ **The list must be regenerated from `PERMISSIONS` when `0034` is written, not
copied from here.** Later phases of this sprint add more keys (item 12/13's
concession work, if it takes any), and a hand-copied list is exactly how the
schema file and the live constraint drift apart — which is the failure this
constraint exists to prevent, one level up.

### Nothing else

Items 1, 2, 3, 4, 15 and 16 are **entirely read-side and client-side**. No table
gained a column, no index was added and no row is rewritten:

| Item | Why it needs no DDL |
| --- | --- |
| 1, 2 | The guardian-card lock is client state. `parseGuardians` is unchanged and remains the rule. |
| 3 | The primary guardian's phone is a joined ordered aggregate over `student_guardians` — no new column, and `student_guardians_student_profile_id_idx` already covers the grouping. |
| 4 | The fee chip is a grouped count over `fee_challans` on `(location_id, status)` and `student_profile_id`, both of which are already indexed. |
| 5 | `DELETE` uses the existing cascades. `fee_payments → fee_challans → student_profiles` answers the refusal. |
| 15, 16 | Pure formatting, on the way out. Storage is unchanged and must stay so — `student_guardians.phone` is an identity. |

### One index worth considering, deliberately not taken

The fee chip's subquery groups every open voucher in the school on each page of
the directory. On a school with a long history that is a scan of
`fee_challans` filtered to two statuses, which
`fee_challans_location_id_status_idx` already serves. A covering index on
`(location_id, status, student_profile_id, due_date, challan_kind)` would serve
it entirely from the index — worth measuring against real data before adding,
and not worth adding on a guess.
