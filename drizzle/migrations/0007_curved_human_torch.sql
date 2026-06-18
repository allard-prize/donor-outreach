CREATE TYPE "public"."eval_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "eval_case" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"prompt_version" text DEFAULT 'v1' NOT NULL,
	"input" jsonb NOT NULL,
	"binary_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rubric" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_behavior" text DEFAULT '' NOT NULL,
	"expected_output" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_run" (
	"id" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"status" "eval_run_status" DEFAULT 'running' NOT NULL,
	"case_count" integer DEFAULT 0 NOT NULL,
	"cases_passed" integer DEFAULT 0 NOT NULL,
	"total_violations" integer DEFAULT 0 NOT NULL,
	"contract_violations" integer DEFAULT 0 NOT NULL,
	"binary_violations" integer DEFAULT 0 NOT NULL,
	"rubric_violations" integer DEFAULT 0 NOT NULL,
	"llm_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"error_message" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE INDEX "eval_case_active_idx" ON "eval_case" USING btree ("active");--> statement-breakpoint
CREATE INDEX "eval_case_prompt_version_idx" ON "eval_case" USING btree ("prompt_version");--> statement-breakpoint
CREATE INDEX "eval_run_started_at_idx" ON "eval_run" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "eval_run_model_idx" ON "eval_run" USING btree ("model");