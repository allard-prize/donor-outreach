-- DESTRUCTIVE
-- Phase 2B schema alignment with spec:
--   * profile_type enum: placeholder values dropped, replaced with spec values.
--     Safe because prospect table is empty.
--   * prospect.deleted_at column dropped (renamed concept → archived_at, distinct column).
--   * prospect_deleted_at_idx dropped (superseded by prospect_archived_at_idx).
CREATE TYPE "public"."processed_status" AS ENUM('pending', 'processed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('rss', 'email', 'linkedin_post');--> statement-breakpoint
CREATE TABLE "result" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"prospect_id" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"title" text NOT NULL,
	"link" text,
	"pub_date" timestamp NOT NULL,
	"content_snippet" text DEFAULT '' NOT NULL,
	"processed_status" "processed_status" DEFAULT 'pending' NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" text PRIMARY KEY NOT NULL,
	"prospect_id" text NOT NULL,
	"rss_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"disabled_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "prospect" ALTER COLUMN "profile_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."profile_type";--> statement-breakpoint
CREATE TYPE "public"."profile_type" AS ENUM('institutional_funder', 'individual_donor', 'connector', 'credibility_node', 'collaborator');--> statement-breakpoint
ALTER TABLE "prospect" ALTER COLUMN "profile_type" SET DATA TYPE "public"."profile_type" USING "profile_type"::"public"."profile_type";--> statement-breakpoint
DROP INDEX "prospect_deleted_at_idx";--> statement-breakpoint
ALTER TABLE "prospect" ADD COLUMN "email_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "result" ADD CONSTRAINT "result_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result" ADD CONSTRAINT "result_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "result_prospect_idx" ON "result" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "result_source_type_idx" ON "result" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "result_processed_status_idx" ON "result" USING btree ("processed_status");--> statement-breakpoint
CREATE INDEX "result_pub_date_idx" ON "result" USING btree ("pub_date");--> statement-breakpoint
CREATE INDEX "source_prospect_idx" ON "source" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "source_disabled_at_idx" ON "source" USING btree ("disabled_at");--> statement-breakpoint
CREATE INDEX "prospect_archived_at_idx" ON "prospect" USING btree ("archived_at");--> statement-breakpoint
ALTER TABLE "prospect" DROP COLUMN "deleted_at";