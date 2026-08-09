-- Two changes, and the second is a defect fix that has nothing to do with the
-- first. Both are here because drizzle-kit diffs the whole schema and found
-- them together; splitting them would mean shipping a migration that leaves a
-- known-broken constraint in place for no reason.
--
-- 1. school_branding.preset_key — the curated palettes a school can pick
--    instead of the three derived from its logo. Nullable, no back-fill: null
--    means "use the derived palette at selected_palette", which is what every
--    existing row already does.
--
-- 2. role_permissions CHECK — **Sprint 9 shipped five permission keys the
--    database refuses.** `exams.read`, `exams.write`, `exams.publish`,
--    `results.enter` and `results.publish` went into PERMISSIONS and
--    DEFAULT_ROLE_PERMISSIONS but never into this constraint, so granting any
--    of them to a custom per-school role fails with a constraint violation.
--
--    It escaped every gate: typecheck and lint cannot see a CHECK constraint,
--    and QA exercised the *default* role matrix, which is code and never
--    touches this table. Only a school editing a role's permissions by hand
--    would have hit it — which is to say, a real customer rather than a test.
--    Verified against the live database before writing this: the constraint
--    listed 16 keys and none of the five.
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_permission_check";--> statement-breakpoint
ALTER TABLE "school_branding" ADD COLUMN "preset_key" text;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_check" CHECK (permission IN ('users.read', 'users.write', 'admissions.read', 'admissions.write', 'fees.read', 'fees.write', 'academics.read', 'academics.write', 'attendance.mark', 'exams.read', 'exams.write', 'exams.publish', 'results.enter', 'results.publish', 'hr.read', 'hr.write', 'payroll.read', 'payroll.write', 'settings.read', 'settings.write', 'permissions.manage'));