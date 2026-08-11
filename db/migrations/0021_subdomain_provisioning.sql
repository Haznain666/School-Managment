-- Record whether `<slug>.<PLATFORM_BASE_DOMAIN>` actually exists at the host.
--
-- A school row and a DNS record live in two different systems, and the second
-- can fail while the first succeeds. Until now nothing in the platform knew
-- whether a school's subdomain had ever been created: the Super Admin panel
-- handed the operator a URL, and on Hostinger that URL resolved only if
-- somebody had separately added the subdomain by hand. A school could sit for
-- days looking provisioned and be unreachable.
--
-- Provisioning is now attempted automatically after the insert, and must not be
-- able to fail the insert -- a hosting API outage cannot be allowed to stop
-- schools being created. That trade is only safe if the failure is *recorded*,
-- which is what these columns are for, and retryable, which is what the status
-- makes possible.
--
-- `unmanaged` is deliberately distinct from `failed`: with no hosting API token
-- configured, provisioning is a manual step rather than a broken one, and there
-- is nothing for an operator to retry. Conflating the two would put a red
-- "Failed" badge on every school of a deployment that never opted in.
--
-- Additive with a default, so existing rows are safe. Existing schools land on
-- `pending` rather than `ready`: the platform has never verified any of them,
-- and claiming otherwise would be a guess about the outside world. Retrying is
-- idempotent, so a school whose subdomain already exists simply moves to
-- `ready` the first time anyone asks.

ALTER TABLE "schools" ADD COLUMN "subdomain_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "subdomain_error" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "subdomain_provisioned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_subdomain_status_check" CHECK ("schools"."subdomain_status" IN ('pending', 'provisioning', 'ready', 'failed', 'unmanaged'));