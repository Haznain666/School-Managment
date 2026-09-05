-- Sprint 28 — `fees.admission` joins the permission catalogue.
--
-- ── What this does, and nothing else ─────────────────────────────────────
-- `role_permissions.permission` carries a CHECK enumerating every key in
-- `lib/permissions.ts`. Sprint 28 adds a 45th — `fees.admission`, which raises
-- one child's admission voucher — so the CHECK is dropped and re-added with the
-- full list. There is no other statement in this file. No table is created, no
-- column is added, and **no row is rewritten**: the `UPDATE` count of this
-- migration is zero by construction.
--
-- ── Why the key is not `fees.write` ──────────────────────────────────────
-- `fees.write` is "set prices, raise vouchers and take payments", and the three
-- roles that needed to bill an admission — Branch Administrator, Principal and
-- Vice Principal — deliberately do not hold it. That is the same control
-- `accounting.settle` draws in the ledger: a head decides who is admitted, and
-- somebody else prices the school and counts its takings.
--
-- The consequence, until now, was a head who could enroll a child
-- (`admissions.write` + `students.create`) and could not bill one. The panel on
-- the child's profile read *Not yet billed* with no button beneath it and no
-- sentence saying why, the enrollment stayed `outstanding`, and the voucher
-- register — a list of vouchers — could never show a child who had none. That
-- is Askari's Student 50 (ASST-2026-0004, Pre-Nursery B), admitted by a
-- Principal against a grade that *is* priced at PKR 35,000, with no
-- `fee_challans` row at all.
--
-- So the new key is deliberately the narrowest thing that fixes it: it raises
-- one voucher, for one child, at an amount `resolveAdmissionFee` computes on
-- the server from the fee structure. It grants nothing over the price list and
-- nothing over taking money. `POST /api/school/students/[id]/admission-challan`
-- is the only route that costs it.
--
-- ── Strictly weaker than the constraint it replaces ──────────────────────
-- Widening a CHECK cannot invalidate an existing row: every value that
-- satisfied `0043`'s 44-key list satisfies this 45-key one, because the list is
-- that list plus one member. Postgres re-validates the table when the
-- constraint is added, so a row somehow holding a value outside the list would
-- surface here as a 23514 rather than being silently accepted — which is the
-- desired failure, not a reason to add `NOT VALID`.
--
-- ── Prove it by attempt, not by existence ────────────────────────────────
-- A CHECK that was dropped and never re-added leaves **every row count
-- identical** and every insert succeeding, which reads on any dashboard as "it
-- worked". Existence is not evidence either: `pg_constraint` will happily show
-- a constraint whose list is a sprint out of date.
--
-- `check-sprint28` is what proves it. It reads the definition out of
-- `pg_constraint` to decide which side of this migration it is on, then
-- **tries** `fees.admission` and requires acceptance after, 23514 before; and
-- **tries** `fees.invent` and requires 23514 either way — both inside
-- transactions that are always rolled back, with the `role_permissions` row
-- count read back afterwards to show nothing was written.
--
-- ── The key already works before this is applied, and that is the trap ───
-- `DEFAULT_ROLE_PERMISSIONS` lives in code, so `fees.admission` works
-- immediately for every role that holds it by default, with no row in this
-- table at all. Every browser test passes. The constraint is only reached when
-- a school *overrides* the default — granting the key to a Coordinator, or
-- taking it from a Principal — which is a screen most testing never touches.
-- Sprint 26 shipped `chat.oversight` that way and `0042` is the repair.

ALTER TABLE "role_permissions"
  DROP CONSTRAINT IF EXISTS "role_permissions_permission_check";--> statement-breakpoint

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_check" CHECK (
  "permission" IN (
    'users.read', 'users.write', 'admissions.read',
    'admissions.write', 'students.read', 'students.create',
    'students.update', 'students.delete', 'students.import',
    'students.promote', 'students.transfer', 'fees.read',
    'fees.write', 'fees.admission',
    'academics.read', 'academics.write',
    'attendance.mark', 'exams.read', 'exams.write',
    'exams.publish', 'results.enter', 'results.publish',
    'results.promotion', 'hr.read', 'hr.write',
    'payroll.read', 'payroll.write', 'payroll.approve',
    'comms.read', 'comms.write', 'comms.send',
    'chat.read', 'chat.send', 'chat.grant',
    'chat.moderate', 'chat.oversight',
    'settings.read', 'settings.write', 'branches.manage',
    'principals.manage', 'permissions.manage', 'calendar.manage',
    'accounting.read', 'accounting.write', 'accounting.settle'
  )
);
