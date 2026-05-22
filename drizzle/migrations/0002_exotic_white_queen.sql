CREATE TYPE "public"."cron_job_name" AS ENUM('rss', 'email_capture', 'linkedin_scrape', 'donor_outreach', 'health_check');--> statement-breakpoint
CREATE TYPE "public"."cron_run_status" AS ENUM('running', 'success', 'failure', 'partial');--> statement-breakpoint
CREATE TABLE "cron_run" (
	"id" text PRIMARY KEY NOT NULL,
	"job_name" "cron_job_name" NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"status" "cron_run_status" DEFAULT 'running' NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE INDEX "cron_run_job_name_idx" ON "cron_run" USING btree ("job_name");--> statement-breakpoint
CREATE INDEX "cron_run_started_at_idx" ON "cron_run" USING btree ("started_at");