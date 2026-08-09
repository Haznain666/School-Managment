-- One *active* enrolment per student per year, not one enrolment.
--
-- Found by running a transfer against the seeded school. A transfer closes the
-- enrolment at the old campus and opens one at the new — both inside the same
-- academic year — and the unqualified unique index forbade the second row, so
-- every transfer failed at the database with "Something went wrong".
--
-- Editing the existing row in place was the obvious alternative and is wrong:
-- `attendance_records.enrollment_id` points at it, so a register taken at the
-- old campus in July would afterwards claim to have been taken at the new one.
-- The child really did have two placements that year.
--
-- The invariant that matters is unchanged — a student is in exactly one class
-- at a time. Making it partial only lets closed rows (`transferred`,
-- `withdrawn`, `graduated`) accumulate, which is what history is.
--
-- Safe to apply against existing data: every current row is either the single
-- enrolment for its (student, year) or already closed, so nothing violates the
-- narrower index that did not violate the wider one.

DROP INDEX "student_enrollments_location_id_profile_year_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "student_enrollments_location_id_profile_year_idx" ON "student_enrollments" USING btree ("location_id","student_profile_id","academic_year_id") WHERE "student_enrollments"."status" = 'active';