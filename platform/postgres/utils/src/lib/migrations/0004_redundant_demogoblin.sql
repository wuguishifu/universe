CREATE TABLE "jankbot"."user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"exclude_from_compilations" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
