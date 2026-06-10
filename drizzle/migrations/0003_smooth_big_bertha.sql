CREATE TYPE "public"."briefing_status" AS ENUM('sent', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."momentum" AS ENUM('increasing', 'stable', 'declining');--> statement-breakpoint
CREATE TYPE "public"."relationship_stage" AS ENUM('no_relationship', 'early', 'warm', 'active', 'stalled', 'dormant');--> statement-breakpoint
CREATE TYPE "public"."responsiveness" AS ENUM('high', 'moderate', 'low', 'none');--> statement-breakpoint
CREATE TYPE "public"."touchpoint_review_status" AS ENUM('pending', 'approved', 'rejected', 'promoted');--> statement-breakpoint
CREATE TYPE "public"."touchpoint_type" AS ENUM('congratulations', 'collaboration', 'content_sharing', 'introduction', 'meeting_request', 'invitation', 'intermediary_engagement', 'follow_up', 'no_action');--> statement-breakpoint
CREATE TABLE "briefing" (
	"id" text PRIMARY KEY NOT NULL,
	"cron_run_id" text,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"recipients" jsonb NOT NULL,
	"prospect_count" integer DEFAULT 0 NOT NULL,
	"alert_count" integer DEFAULT 0 NOT NULL,
	"html_body" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"llm_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"llm_call_count" integer DEFAULT 0 NOT NULL,
	"status" "briefing_status" DEFAULT 'sent' NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "monitoring_result" (
	"id" text PRIMARY KEY NOT NULL,
	"prospect_id" text NOT NULL,
	"run_date" date NOT NULL,
	"stage" "relationship_stage" NOT NULL,
	"responsiveness" "responsiveness" NOT NULL,
	"momentum" "momentum" NOT NULL,
	"interpretation" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"key_alerts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"briefing_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "touchpoint_potential" (
	"id" text PRIMARY KEY NOT NULL,
	"prospect_id" text NOT NULL,
	"run_date" date NOT NULL,
	"touchpoint_type" "touchpoint_type" NOT NULL,
	"priority_score" integer NOT NULL,
	"engagement_rationale" text DEFAULT '' NOT NULL,
	"draft_content" text DEFAULT '' NOT NULL,
	"review_status" "touchpoint_review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"promoted_to_assigned_id" text,
	"briefing_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "briefing" ADD CONSTRAINT "briefing_cron_run_id_cron_run_id_fk" FOREIGN KEY ("cron_run_id") REFERENCES "public"."cron_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_result" ADD CONSTRAINT "monitoring_result_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_result" ADD CONSTRAINT "monitoring_result_briefing_id_briefing_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touchpoint_potential" ADD CONSTRAINT "touchpoint_potential_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touchpoint_potential" ADD CONSTRAINT "touchpoint_potential_briefing_id_briefing_id_fk" FOREIGN KEY ("briefing_id") REFERENCES "public"."briefing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefing_sent_at_idx" ON "briefing" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "briefing_status_idx" ON "briefing" USING btree ("status");--> statement-breakpoint
CREATE INDEX "monitoring_result_prospect_idx" ON "monitoring_result" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "monitoring_result_run_date_idx" ON "monitoring_result" USING btree ("run_date");--> statement-breakpoint
CREATE INDEX "touchpoint_potential_prospect_idx" ON "touchpoint_potential" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "touchpoint_potential_run_date_idx" ON "touchpoint_potential" USING btree ("run_date");--> statement-breakpoint
CREATE INDEX "touchpoint_potential_review_status_idx" ON "touchpoint_potential" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "touchpoint_potential_priority_score_idx" ON "touchpoint_potential" USING btree ("priority_score");