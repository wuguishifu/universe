CREATE SCHEMA "osmium";
--> statement-breakpoint
CREATE TABLE "osmium"."events" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"source" text NOT NULL,
	"metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "osmium_events_name_created_at_idx" ON "osmium"."events" USING btree ("name","created_at");