ALTER TABLE "events" ADD COLUMN "extra" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "extra" DROP DEFAULT;
