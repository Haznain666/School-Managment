CREATE TABLE "fee_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fee_category" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_types_fee_category_check" CHECK ("fee_types"."fee_category" IN ('monthly', 'one_time', 'annual'))
);
--> statement-breakpoint
CREATE TABLE "fee_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"fee_type_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_structures_amount_check" CHECK ("fee_structures"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "student_concessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"concession_name" text NOT NULL,
	"discount_type" text NOT NULL,
	"discount_value" numeric(10, 2) NOT NULL,
	"applies_to_fee_type_id" uuid,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"approved_by_uid" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_concessions_discount_type_check" CHECK ("student_concessions"."discount_type" IN ('percentage', 'fixed'))
);
--> statement-breakpoint
CREATE TABLE "fee_challans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"challan_number" text NOT NULL,
	"billing_month" integer,
	"billing_year" integer,
	"due_date" date NOT NULL,
	"issue_date" date DEFAULT now() NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"concession_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"late_fee_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"paid_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"notes" text,
	"generated_by_uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_challans_challan_number_unique" UNIQUE("challan_number"),
	CONSTRAINT "fee_challans_billing_month_check" CHECK ("fee_challans"."billing_month" BETWEEN 1 AND 12),
	CONSTRAINT "fee_challans_status_check" CHECK ("fee_challans"."status" IN ('unpaid', 'partial', 'paid', 'cancelled', 'waived'))
);
--> statement-breakpoint
CREATE TABLE "fee_challan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"challan_id" uuid NOT NULL,
	"fee_type_id" uuid,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"concession_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"challan_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" text NOT NULL,
	"reference_number" text,
	"payment_date" date DEFAULT now() NOT NULL,
	"collected_by_uid" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payments_amount_check" CHECK ("fee_payments"."amount" > 0),
	CONSTRAINT "fee_payments_payment_method_check" CHECK ("fee_payments"."payment_method" IN ('cash', 'bank_transfer', 'cheque'))
);
--> statement-breakpoint
CREATE TABLE "late_fee_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"due_day" integer DEFAULT 10 NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"grace_days" integer DEFAULT 0 NOT NULL,
	"late_fee_type" text DEFAULT 'fixed' NOT NULL,
	"late_fee_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"max_late_fee" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "late_fee_rules_location_id_unique" UNIQUE("location_id"),
	CONSTRAINT "late_fee_rules_late_fee_type_check" CHECK ("late_fee_rules"."late_fee_type" IN ('fixed', 'daily')),
	CONSTRAINT "late_fee_rules_due_day_check" CHECK ("late_fee_rules"."due_day" BETWEEN 1 AND 28)
);
--> statement-breakpoint
CREATE TABLE "challan_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"billing_month" integer NOT NULL,
	"billing_year" integer NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_fee_type_id_fee_types_id_fk" FOREIGN KEY ("fee_type_id") REFERENCES "public"."fee_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_applies_to_fee_type_id_fee_types_id_fk" FOREIGN KEY ("applies_to_fee_type_id") REFERENCES "public"."fee_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_challans" ADD CONSTRAINT "fee_challans_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_challans" ADD CONSTRAINT "fee_challans_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_challans" ADD CONSTRAINT "fee_challans_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_challan_items" ADD CONSTRAINT "fee_challan_items_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_challan_items" ADD CONSTRAINT "fee_challan_items_challan_id_fee_challans_id_fk" FOREIGN KEY ("challan_id") REFERENCES "public"."fee_challans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_challan_items" ADD CONSTRAINT "fee_challan_items_fee_type_id_fee_types_id_fk" FOREIGN KEY ("fee_type_id") REFERENCES "public"."fee_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_challan_id_fee_challans_id_fk" FOREIGN KEY ("challan_id") REFERENCES "public"."fee_challans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_sequences" ADD CONSTRAINT "challan_sequences_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_types_location_id_idx" ON "fee_types" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_types_location_id_name_idx" ON "fee_types" USING btree ("location_id","name");--> statement-breakpoint
CREATE INDEX "fee_structures_location_id_idx" ON "fee_structures" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "fee_structures_grade_id_academic_year_id_idx" ON "fee_structures" USING btree ("grade_id","academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_structures_type_grade_year_idx" ON "fee_structures" USING btree ("fee_type_id","grade_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "student_concessions_location_id_idx" ON "student_concessions" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "student_concessions_student_profile_id_idx" ON "student_concessions" USING btree ("student_profile_id");--> statement-breakpoint
CREATE INDEX "fee_challans_location_id_idx" ON "fee_challans" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "fee_challans_student_profile_id_idx" ON "fee_challans" USING btree ("student_profile_id");--> statement-breakpoint
CREATE INDEX "fee_challans_location_id_status_idx" ON "fee_challans" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "fee_challans_location_id_due_date_idx" ON "fee_challans" USING btree ("location_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_challans_student_month_year_idx" ON "fee_challans" USING btree ("student_profile_id","billing_month","billing_year","academic_year_id");--> statement-breakpoint
CREATE INDEX "fee_challan_items_challan_id_idx" ON "fee_challan_items" USING btree ("challan_id");--> statement-breakpoint
CREATE INDEX "fee_payments_location_id_idx" ON "fee_payments" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "fee_payments_challan_id_idx" ON "fee_payments" USING btree ("challan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "challan_sequences_location_month_year_idx" ON "challan_sequences" USING btree ("location_id","billing_month","billing_year");