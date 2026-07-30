CREATE TABLE "auth_otp_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"phone" text NOT NULL,
	"otp_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"invite_token" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_otp_sessions_purpose_check" CHECK (purpose IN ('login', 'invite_acceptance'))
);
--> statement-breakpoint
ALTER TABLE "auth_otp_sessions" ADD CONSTRAINT "auth_otp_sessions_location_id_schools_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."schools"("location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_otp_sessions_location_id_idx" ON "auth_otp_sessions" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "auth_otp_sessions_lookup_idx" ON "auth_otp_sessions" USING btree ("location_id","phone","purpose") WHERE used_at IS NULL;--> statement-breakpoint
CREATE INDEX "auth_otp_sessions_expires_at_idx" ON "auth_otp_sessions" USING btree ("expires_at");