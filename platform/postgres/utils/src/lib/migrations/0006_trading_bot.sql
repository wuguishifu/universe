CREATE SCHEMA "trading";
--> statement-breakpoint
CREATE TABLE "trading"."bars" (
	"ticker" text NOT NULL,
	"feed" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" double precision NOT NULL,
	"source" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"correction" jsonb,
	CONSTRAINT "bars_ticker_feed_time_pk" PRIMARY KEY("ticker","feed","time")
);
--> statement-breakpoint
CREATE TABLE "trading"."broker_orders" (
	"client_order_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"broker_order_id" text,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"type" text NOT NULL,
	"qty" integer NOT NULL,
	"limit_price" double precision,
	"status" text NOT NULL,
	"filled_qty" integer DEFAULT 0 NOT NULL,
	"filled_avg_price" double precision,
	"submitted_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"quote_at_submit" jsonb,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "trading"."chain_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"underlying" text NOT NULL,
	"type" text NOT NULL,
	"underlying_price" double precision NOT NULL,
	"feed" text NOT NULL,
	"contracts" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading"."days" (
	"date" text PRIMARY KEY NOT NULL,
	"run_ids" jsonb NOT NULL,
	"stock_feed" text NOT NULL,
	"options_feed" text NOT NULL,
	"signals" jsonb NOT NULL,
	"trades" jsonb NOT NULL,
	"net_pnl" double precision NOT NULL,
	"data_health" jsonb NOT NULL,
	"account" jsonb,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading"."engine_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"ticker" text,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading"."incidents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading"."option_quotes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"symbol" text NOT NULL,
	"feed" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"bid" double precision NOT NULL,
	"ask" double precision NOT NULL,
	"bid_size" integer,
	"ask_size" integer
);
--> statement-breakpoint
CREATE TABLE "trading"."positions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"ticker" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"qty" integer NOT NULL,
	"entry_price" double precision NOT NULL,
	"entry_time" timestamp with time zone NOT NULL,
	"entry_date" text NOT NULL,
	"position" jsonb NOT NULL,
	"status" text NOT NULL,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading"."runs" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"version" text NOT NULL,
	"environment" text NOT NULL,
	"account" text NOT NULL,
	"stock_feed" text NOT NULL,
	"options_feed" text NOT NULL,
	"strategy" jsonb NOT NULL,
	"settings" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading"."trade_updates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"client_order_id" text NOT NULL,
	"event" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading"."trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"position_id" text NOT NULL,
	"trade_date" text NOT NULL,
	"ticker" text NOT NULL,
	"direction" text NOT NULL,
	"symbol" text NOT NULL,
	"qty" integer NOT NULL,
	"reason" text NOT NULL,
	"entry_time" timestamp with time zone NOT NULL,
	"exit_time" timestamp with time zone NOT NULL,
	"entry_price" double precision NOT NULL,
	"exit_price" double precision NOT NULL,
	"entry_ref_price" double precision,
	"exit_ref_price" double precision,
	"entry_slippage" double precision,
	"exit_slippage" double precision,
	"pnl" double precision NOT NULL,
	"fees" double precision NOT NULL,
	"net_pnl" double precision NOT NULL,
	"nbbo" jsonb
);
--> statement-breakpoint
CREATE INDEX "broker_orders_intent_id_idx" ON "trading"."broker_orders" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "chain_snapshots_time_idx" ON "trading"."chain_snapshots" USING btree ("time");--> statement-breakpoint
CREATE INDEX "engine_events_run_id_time_idx" ON "trading"."engine_events" USING btree ("run_id","time");--> statement-breakpoint
CREATE INDEX "engine_events_type_time_idx" ON "trading"."engine_events" USING btree ("type","time");--> statement-breakpoint
CREATE INDEX "incidents_time_idx" ON "trading"."incidents" USING btree ("time");--> statement-breakpoint
CREATE INDEX "option_quotes_symbol_time_idx" ON "trading"."option_quotes" USING btree ("symbol","time");--> statement-breakpoint
CREATE INDEX "positions_status_idx" ON "trading"."positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trade_updates_client_order_id_idx" ON "trading"."trade_updates" USING btree ("client_order_id");--> statement-breakpoint
CREATE INDEX "trades_trade_date_idx" ON "trading"."trades" USING btree ("trade_date");