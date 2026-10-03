CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"properties" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "events_name_timestamp_idx" ON "events" USING btree ("name","timestamp");--> statement-breakpoint
CREATE INDEX "events_timestamp_idx" ON "events" USING btree ("timestamp");