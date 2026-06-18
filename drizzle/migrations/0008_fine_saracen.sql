CREATE TABLE "app_token" (
	"key" text PRIMARY KEY NOT NULL,
	"refresh_token" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
