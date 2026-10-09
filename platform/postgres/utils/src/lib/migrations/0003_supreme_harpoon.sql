CREATE SCHEMA "jankbot";
--> statement-breakpoint
CREATE TABLE "jankbot"."recordings" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"utterance_id" text NOT NULL,
	"phrase" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"clips" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "recordings_session_id_phrase_timestamp_idx" ON "jankbot"."recordings" USING btree ("session_id","phrase","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "recordings_utterance_id_phrase_idx" ON "jankbot"."recordings" USING btree ("utterance_id","phrase");