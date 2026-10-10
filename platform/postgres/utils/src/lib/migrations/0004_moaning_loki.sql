CREATE TABLE "jankbot"."compilation_opt_outs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"opted_out_at" timestamp with time zone DEFAULT now() NOT NULL
);
