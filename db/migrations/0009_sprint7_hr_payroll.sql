CREATE TABLE "salary_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"calculation" text DEFAULT 'fixed' NOT NULL,
	"default_percent_basis_points" integer,
	"is_basic" boolean DEFAULT false NOT NULL,
	"prorated_by_attendance" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_components_kind_check" CHECK ("salary_components"."kind" IN ('earning', 'deduction')),
	CONSTRAINT "salary_components_calculation_check" CHECK ("salary_components"."calculation" IN ('fixed', 'percent_of_basic')),
	CONSTRAINT "salary_components_percent_check" CHECK ("salary_components"."default_percent_basis_points" IS NULL OR ("salary_components"."default_percent_basis_points" >= 0 AND "salary_components"."default_percent_basis_points" <= 100000))
);
--> statement-breakpoint
CREATE TABLE "staff_salary_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"percent_basis_points" integer,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"annual_quota_days" integer DEFAULT 0 NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_annual_quota_days_check" CHECK ("leave_types"."annual_quota_days" >= 0 AND "leave_types"."annual_quota_days" <= 365)
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"total_days" numeric(4, 1) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_status_check" CHECK ("leave_requests"."status" IN ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "leave_requests_date_order_check" CHECK ("leave_requests"."end_date" >= "leave_requests"."start_date"),
	CONSTRAINT "leave_requests_total_days_check" CHECK ("leave_requests"."total_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "staff_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"marked_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_attendance_status_check" CHECK ("staff_attendance"."status" IN ('present', 'absent', 'late', 'half_day', 'leave', 'holiday'))
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"branch_id" uuid,
	"payroll_month" integer NOT NULL,
	"payroll_year" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"working_days" integer DEFAULT 26 NOT NULL,
	"staff_count" integer DEFAULT 0 NOT NULL,
	"gross_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"deduction_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"generated_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_status_check" CHECK ("payroll_runs"."status" IN ('draft', 'approved', 'paid', 'cancelled')),
	CONSTRAINT "payroll_runs_payroll_month_check" CHECK ("payroll_runs"."payroll_month" >= 1 AND "payroll_runs"."payroll_month" <= 12),
	CONSTRAINT "payroll_runs_payroll_year_check" CHECK ("payroll_runs"."payroll_year" >= 2000 AND "payroll_runs"."payroll_year" <= 2100),
	CONSTRAINT "payroll_runs_working_days_check" CHECK ("payroll_runs"."working_days" >= 1 AND "payroll_runs"."working_days" <= 31)
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"branch_id" uuid,
	"payslip_number" text NOT NULL,
	"staff_name" text NOT NULL,
	"employee_code" text NOT NULL,
	"designation" text,
	"bank_account_title" text,
	"bank_account_number" text,
	"bank_name" text,
	"gross_earnings" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_deductions" numeric(12, 2) DEFAULT '0' NOT NULL,
	"loss_of_pay_days" numeric(4, 1) DEFAULT '0' NOT NULL,
	"loss_of_pay_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_payable" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"payment_mode" text,
	"paid_on" date,
	"payment_reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_payslip_number_unique" UNIQUE("payslip_number"),
	CONSTRAINT "payslips_status_check" CHECK ("payslips"."status" IN ('unpaid', 'paid', 'held')),
	CONSTRAINT "payslips_payment_mode_check" CHECK ("payslips"."payment_mode" IS NULL OR "payslips"."payment_mode" IN ('bank_transfer', 'cash', 'cheque')),
	CONSTRAINT "payslips_net_payable_check" CHECK ("payslips"."net_payable" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payslip_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"payslip_id" uuid NOT NULL,
	"component_id" uuid,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslip_items_kind_check" CHECK ("payslip_items"."kind" IN ('earning', 'deduction'))
);
--> statement-breakpoint
CREATE TABLE "payslip_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"payroll_month" integer NOT NULL,
	"payroll_year" integer NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "school_user_id" uuid;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "cnic" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "qualification" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "bank_account_title" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "bank_account_number" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "resigned_on" date;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_salary_structures" ADD CONSTRAINT "staff_salary_structures_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_salary_structures" ADD CONSTRAINT "staff_salary_structures_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_salary_structures" ADD CONSTRAINT "staff_salary_structures_component_id_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."salary_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_school_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."school_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_marked_by_school_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."school_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_generated_by_school_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."school_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_school_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."school_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_items" ADD CONSTRAINT "payslip_items_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_items" ADD CONSTRAINT "payslip_items_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_items" ADD CONSTRAINT "payslip_items_component_id_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."salary_components"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_sequences" ADD CONSTRAINT "payslip_sequences_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "salary_components_location_id_idx" ON "salary_components" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_components_location_id_name_idx" ON "salary_components" USING btree ("location_id","name");--> statement-breakpoint
CREATE INDEX "staff_salary_structures_location_id_idx" ON "staff_salary_structures" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "staff_salary_structures_staff_id_idx" ON "staff_salary_structures" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_salary_structures_staff_component_idx" ON "staff_salary_structures" USING btree ("staff_id","component_id");--> statement-breakpoint
CREATE INDEX "leave_types_location_id_idx" ON "leave_types" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_location_id_name_idx" ON "leave_types" USING btree ("location_id","name");--> statement-breakpoint
CREATE INDEX "leave_requests_location_id_idx" ON "leave_requests" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "leave_requests_location_id_status_idx" ON "leave_requests" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "leave_requests_staff_id_idx" ON "leave_requests" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "leave_requests_location_id_start_date_idx" ON "leave_requests" USING btree ("location_id","start_date");--> statement-breakpoint
CREATE INDEX "staff_attendance_location_id_date_idx" ON "staff_attendance" USING btree ("location_id","date");--> statement-breakpoint
CREATE INDEX "staff_attendance_staff_id_idx" ON "staff_attendance" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_attendance_location_date_staff_idx" ON "staff_attendance" USING btree ("location_id","date","staff_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_location_id_idx" ON "payroll_runs" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_location_id_status_idx" ON "payroll_runs" USING btree ("location_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_location_branch_period_idx" ON "payroll_runs" USING btree ("location_id","branch_id","payroll_month","payroll_year");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_location_period_whole_school_idx" ON "payroll_runs" USING btree ("location_id","payroll_month","payroll_year") WHERE branch_id IS NULL;--> statement-breakpoint
CREATE INDEX "payslips_location_id_idx" ON "payslips" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "payslips_payroll_run_id_idx" ON "payslips" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "payslips_location_id_status_idx" ON "payslips" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "payslips_staff_id_idx" ON "payslips" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_run_staff_idx" ON "payslips" USING btree ("payroll_run_id","staff_id");--> statement-breakpoint
CREATE INDEX "payslip_items_location_id_idx" ON "payslip_items" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "payslip_items_payslip_id_idx" ON "payslip_items" USING btree ("payslip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_sequences_location_month_year_idx" ON "payslip_sequences" USING btree ("location_id","payroll_month","payroll_year");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_school_user_id_school_users_id_fk" FOREIGN KEY ("school_user_id") REFERENCES "public"."school_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_location_id_status_idx" ON "staff" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "staff_school_user_id_idx" ON "staff" USING btree ("school_user_id");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_gender_check" CHECK (gender IS NULL OR gender IN ('male', 'female', 'other'));