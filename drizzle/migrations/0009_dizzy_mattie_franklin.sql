-- DESTRUCTIVE: drops touchpoint_potential (0 rows — Phase 1 Potential sheet unused since 2025) + its enum; the recommendation now lives on monitoring_result columns
ALTER TABLE "touchpoint_potential" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "touchpoint_potential" CASCADE;--> statement-breakpoint
ALTER TABLE "monitoring_result" ADD COLUMN "touchpoint_type" "touchpoint_type";--> statement-breakpoint
ALTER TABLE "monitoring_result" ADD COLUMN "priority_score" integer;--> statement-breakpoint
ALTER TABLE "monitoring_result" ADD COLUMN "engagement_rationale" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_result" ADD COLUMN "draft_content" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "monitoring_result_priority_score_idx" ON "monitoring_result" USING btree ("priority_score");--> statement-breakpoint
DROP TYPE "public"."touchpoint_review_status";