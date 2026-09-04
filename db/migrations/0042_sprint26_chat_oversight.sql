-- Sprint 26 — `chat.oversight` joins the permission catalogue.
--
-- ── Why this migration exists, and why it is one line of real work ───────
-- `role_permissions.permission` carries a CHECK enumerating every key in
-- `lib/permissions.ts`. Sprint 26 added a 42nd — `chat.oversight`, which opens
-- *All conversations* — and shipped without widening it.
--
-- `0040`'s own Step 10 comment predicted this exactly:
--
--   > a new key in `PERMISSIONS` without this rewrite fails at the first time
--   > an administrator saves the permission matrix, not at build and not here.
--
-- That is precisely what happened, and it is worth being clear about what was
-- broken and what was not:
--
--   · **Oversight itself worked.** The default matrix lives in code
--     (`DEFAULT_ROLE_PERMISSIONS`), so a School Administrator and a Principal
--     held the permission with no row in this table at all. Every browser test
--     in Sprint 26's QA passed for that reason.
--   · **Changing it would have failed.** The moment a school moved
--     `chat.oversight` in Roles & Permissions — granting it to a Vice
--     Principal, or taking it away from a Principal — the insert would have
--     been refused by this constraint with a 23514, on a screen that had never
--     failed before.
--
-- A latent defect that only fires on a screen nobody had touched yet is the
-- kind that reaches a school before it reaches a test. `check-branch-scope`
-- caught it in CI, which is what that assertion is for.
--
-- ── Nothing is rewritten ─────────────────────────────────────────────────
-- Widening a CHECK cannot invalidate an existing row: every value that
-- satisfied the 41-key list satisfies the 42-key one. The census either side is
-- the evidence — `role_permissions` holds 11 rows before and 11 after — and the
-- exit code is not.
--
-- Postgres re-validates the table when the constraint is added, so a row that
-- somehow held a value outside the list would surface here as a 23514 rather
-- than being silently accepted. That is the desired failure.

ALTER TABLE "role_permissions"
  DROP CONSTRAINT IF EXISTS "role_permissions_permission_check";--> statement-breakpoint

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_check" CHECK (
  "permission" IN (
    'users.read', 'users.write', 'admissions.read',
    'admissions.write', 'students.read', 'students.create',
    'students.update', 'students.delete', 'students.import',
    'students.promote', 'students.transfer', 'fees.read',
    'fees.write', 'academics.read', 'academics.write',
    'attendance.mark', 'exams.read', 'exams.write',
    'exams.publish', 'results.enter', 'results.publish',
    'results.promotion', 'hr.read', 'hr.write',
    'payroll.read', 'payroll.write', 'comms.read',
    'comms.write', 'comms.send', 'chat.read',
    'chat.send', 'chat.grant', 'chat.moderate',
    'chat.oversight',
    'settings.read', 'settings.write', 'branches.manage',
    'principals.manage', 'permissions.manage', 'accounting.read',
    'accounting.write', 'accounting.settle'
  )
);
