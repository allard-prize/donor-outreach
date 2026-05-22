CREATE TABLE "touchpoint_assigned" (
	"id" text PRIMARY KEY NOT NULL,
	"prospect_id" text NOT NULL,
	"touchpoint_type" "touchpoint_type" NOT NULL,
	"completed_date" date NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"response" text,
	"next_step" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "touchpoint_assigned" ADD CONSTRAINT "touchpoint_assigned_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "touchpoint_assigned_prospect_idx" ON "touchpoint_assigned" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "touchpoint_assigned_completed_date_idx" ON "touchpoint_assigned" USING btree ("completed_date");