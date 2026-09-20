/*
 * 0050 — Row Level Security on every public table, and the grants that made
 * its absence critical rather than theoretical.
 *
 * ── What was actually true before this migration ─────────────────────────
 * Measured against the live database on 2026-09-20, not inferred:
 *
 *   118 of 119 tables in `public` had `relrowsecurity = false`.
 *   `anon` held SELECT, INSERT, UPDATE, DELETE **and TRUNCATE** on all 119.
 *   `anon` and `authenticated` both have `rolbypassrls = false`.
 *
 * Those three facts together are the whole story. RLS is the only gate that
 * stands between a role and a table it has been granted; with RLS off, the
 * grant is the entire access decision. And the credential that assumes `anon`
 * is `NEXT_PUBLIC_SUPABASE_ANON_KEY` — read at build time and inlined into the
 * browser bundle, as its own name says. It is served to every visitor of every
 * tenant, signed out included.
 *
 * So every student profile, every guardian CNIC, every fee challan, every
 * ledger entry and every chat message at every school was readable — and
 * writable, and truncatable — by anyone who opened devtools on the sign-in
 * page. Not a lint warning. A live hole, open since the project moved to
 * Supabase, with nothing in the repository that would have reported it: no
 * check script executes a grant, and the application itself never notices,
 * because the application does not use this door.
 *
 * ── Why turning it on cannot break anything here ─────────────────────────
 * This codebase reads its data exactly one way — Drizzle over postgres-js, as
 * the `postgres` role, which has `rolbypassrls = true`. Middleware and Storage
 * reach PostgREST as `service_role`, also `bypassrls`. Nothing anywhere calls
 * `.from()` on a supabase-js client: grepped across `lib`, `components` and
 * `app`, the count is zero. The anon key is used for precisely two things —
 * GoTrue session handling, which lives in the `auth` schema and is untouched
 * by any of this, and the browser's Realtime subscription.
 *
 * ── `chat_signals` is deliberately absent below ──────────────────────────
 * It is the one table a browser is allowed to read directly, it is the only
 * table in the `supabase_realtime` publication, and it is the one table that
 * already had RLS and a policy — `chat_signals_own`, USING
 * `recipient_auth_user_id = auth.uid()::text`, granted to `authenticated`.
 * Its schema docblock explains at length why the socket carries a signal and
 * never content. It keeps its grant and its policy untouched: revoke SELECT
 * there and `postgres_changes` stops delivering, which is the one way this
 * migration could have been felt by a user.
 *
 * ── RLS *and* REVOKE, not one of them ────────────────────────────────────
 * Enabling RLS alone closes the hole today. Revoking the grants means it takes
 * two mistakes rather than one to reopen it: a future permissive policy added
 * without thought is inert if the role cannot reach the table at all. The
 * grants exist only because Supabase's default privileges hand them out to
 * every new table; nothing in this product ever asked for them.
 *
 * ── The function ─────────────────────────────────────────────────────────
 * `staff_kpi_ratings_refuse_update` is the last advisory: a function with a
 * mutable `search_path`. It resolves nothing and only RAISEs, so pinning it to
 * the empty path costs nothing and removes the warning.
 */

-- Part 1 — enable RLS on all 118 unprotected tables.

ALTER TABLE "public"."academic_year_branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."academic_years" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."admission_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."announcement_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."announcement_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."attendance_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."auth_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."auth_otp_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."branch_leave_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."cash_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."challan_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."chat_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."chat_broadcasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."chat_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."chat_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."chat_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."chat_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."chat_school_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."chat_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."concession_scheme_fee_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."concession_schemes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."coordinator_teachers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."email_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."emergency_login_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."exam_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."exam_schedule_grades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."exam_schedule_subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."exam_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."exam_subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."exam_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."exams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."expense_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."family_challans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."fee_challan_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."fee_challan_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."fee_challans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."fee_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."fee_structures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."fee_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."feedback_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."feedback_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."feedback_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."ghl_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."grade_promotion_criteria" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."grades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."grading_bands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."grading_schemes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."holiday_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."late_fee_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."leave_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."ledger_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."ledger_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."lesson_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."password_setup_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payroll_run_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payroll_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payslip_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payslip_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payslips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."period_structure_grades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."period_structures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."principal_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."promotion_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."promotion_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."result_subcategories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."salary_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."saturday_duty_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."school_branding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."school_exam_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."school_id_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."school_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."school_modules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."school_user_branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."school_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."schools" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."section_head_coordinators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."staff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."staff_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."staff_calendar_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."staff_calendars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."staff_kpi_ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."staff_kpi_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."staff_kpis" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."staff_salary_structures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."student_concession_fee_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."student_concessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."student_credits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."student_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."student_enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."student_guardians" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."student_import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."student_import_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."student_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."student_term_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."student_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."students" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."teacher_principal_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."teacher_principals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."timetable_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."timetable_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."timetable_substitutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."vice_principal_principals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Part 2 — take back the grants Supabase's default privileges handed out.
-- `chat_signals` is not in this list and keeps its SELECT for `authenticated`.

REVOKE ALL ON TABLE "public"."academic_year_branches" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."academic_years" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."admission_applications" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."announcement_reads" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."announcement_recipients" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."announcements" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."attendance_records" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."auth_attempts" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."auth_otp_sessions" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."bank_accounts" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."branch_leave_settings" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."branches" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."cash_settlements" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."challan_sequences" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."chat_attachments" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."chat_broadcasts" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."chat_conversations" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."chat_grants" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."chat_messages" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."chat_participants" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."chat_reports" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."chat_school_settings" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."chat_settings" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."concession_scheme_fee_types" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."concession_schemes" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."coordinator_teachers" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."email_outbox" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."emergency_login_tokens" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."exam_results" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."exam_schedule_grades" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."exam_schedule_subjects" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."exam_schedules" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."exam_subjects" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."exam_terms" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."exams" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."expense_categories" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."expenses" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."family_challans" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."fee_challan_items" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."fee_challan_reminders" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."fee_challans" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."fee_payments" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."fee_structures" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."fee_types" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."feedback_attachments" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."feedback_replies" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."feedback_tickets" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."ghl_tokens" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."grade_promotion_criteria" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."grades" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."grading_bands" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."grading_schemes" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."holiday_notifications" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."holidays" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."late_fee_rules" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."leave_requests" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."leave_types" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."ledger_accounts" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."ledger_entries" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."ledger_transactions" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."lesson_plans" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."notification_preferences" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."notifications" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."password_setup_tokens" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."payroll_run_approvals" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."payroll_runs" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."payslip_items" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."payslip_sequences" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."payslips" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."period_structure_grades" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."period_structures" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."principal_assignments" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."promotion_decisions" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."promotion_runs" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."push_subscriptions" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."result_subcategories" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."role_permissions" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."salary_components" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."saturday_duty_policies" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."school_branding" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."school_exam_settings" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."school_id_sequences" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."school_invitations" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."school_modules" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."school_user_branches" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."school_users" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."schools" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."section_head_coordinators" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."sections" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."staff" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."staff_attendance" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."staff_calendar_overrides" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."staff_calendars" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."staff_kpi_ratings" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."staff_kpi_settings" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."staff_kpis" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."staff_salary_structures" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."student_concession_fee_types" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."student_concessions" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."student_credits" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."student_documents" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."student_enrollments" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."student_guardians" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."student_import_batches" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."student_import_rows" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."student_profiles" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."student_term_results" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."student_transfers" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."students" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."subjects" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."teacher_principal_transfers" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."teacher_principals" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."timetable_entries" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."timetable_slots" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."timetable_substitutions" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."user_roles" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."users" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "public"."vice_principal_principals" FROM "anon", "authenticated";--> statement-breakpoint

-- Part 3 — stop future tables inheriting the same grants.

ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon", "authenticated";--> statement-breakpoint

-- Part 4 — the one function advisory.

ALTER FUNCTION "public"."staff_kpi_ratings_refuse_update"() SET search_path = '';
