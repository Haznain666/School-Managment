-- Record *which* identity document `b_form_cnic` holds.
--
-- The enrolment form asked for "B-Form / CNIC" in one free-text box. A child is
-- admitted on a B-Form and holds a CNIC once they are eighteen, and the number
-- alone cannot tell them apart — a B-Form is thirteen digits in the same
-- `42101-1234567-1` shape. So the roll recorded a number nobody could attribute
-- to a document; the form now asks for the document first.
--
-- Additive and nullable, so it is safe against existing data: every current row
-- keeps its number and simply has no document type. Deliberately **not**
-- back-filled — inferring the document from its digits is precisely the
-- ambiguity this column exists to end, and a guess written into the roll would
-- be indistinguishable from a clerk having sighted the paper.

ALTER TABLE "student_profiles" ADD COLUMN "id_document_type" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_id_document_type_check" CHECK ("student_profiles"."id_document_type" IS NULL OR "student_profiles"."id_document_type" IN ('cnic', 'b_form'));