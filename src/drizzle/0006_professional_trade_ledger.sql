CREATE TABLE IF NOT EXISTS "official_order_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "real_trade_order_id" uuid REFERENCES "real_trade_orders"("id") ON DELETE set null,
  "strategy_id" uuid REFERENCES "strategies"("id") ON DELETE set null,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "platform" "platform" NOT NULL,
  "official_order_id" varchar(255) NOT NULL,
  "event_key" varchar(512) NOT NULL,
  "status" varchar(50) NOT NULL,
  "requested_quantity" numeric(18,6), "filled_quantity" numeric(18,6), "remaining_quantity" numeric(18,6),
  "occurred_at" timestamp with time zone, "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "official_order_events_key_idx" ON "official_order_events" ("event_key");
CREATE INDEX IF NOT EXISTS "official_order_events_order_idx" ON "official_order_events" ("official_order_id");
CREATE INDEX IF NOT EXISTS "official_order_events_strategy_idx" ON "official_order_events" ("strategy_id");

CREATE TABLE IF NOT EXISTS "official_trade_fills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "real_trade_order_id" uuid REFERENCES "real_trade_orders"("id") ON DELETE set null,
  "strategy_id" uuid REFERENCES "strategies"("id") ON DELETE set null,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "platform" "platform" NOT NULL, "official_fill_id" varchar(255) NOT NULL,
  "official_trade_id" varchar(255), "official_order_id" varchar(255), "market_id" varchar(255) NOT NULL,
  "outcome" "outcome" NOT NULL, "side" "trade_action" NOT NULL,
  "quantity" numeric(18,6) NOT NULL, "price" numeric(18,6) NOT NULL, "fee" numeric(18,6) DEFAULT 0 NOT NULL,
  "is_taker" boolean, "filled_at" timestamp with time zone NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL, "observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "official_trade_fills_venue_idx" ON "official_trade_fills" ("platform", "official_fill_id");
CREATE INDEX IF NOT EXISTS "official_trade_fills_order_idx" ON "official_trade_fills" ("official_order_id");
CREATE INDEX IF NOT EXISTS "official_trade_fills_strategy_idx" ON "official_trade_fills" ("strategy_id");
CREATE INDEX IF NOT EXISTS "official_trade_fills_market_idx" ON "official_trade_fills" ("market_id");

CREATE TABLE IF NOT EXISTS "official_settlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "platform" "platform" NOT NULL,
  "settlement_key" varchar(512) NOT NULL, "market_id" varchar(255) NOT NULL, "event_id" varchar(255),
  "market_result" varchar(50) NOT NULL, "yes_quantity" numeric(18,6) DEFAULT 0 NOT NULL,
  "no_quantity" numeric(18,6) DEFAULT 0 NOT NULL, "yes_cost" numeric(18,6) DEFAULT 0 NOT NULL,
  "no_cost" numeric(18,6) DEFAULT 0 NOT NULL, "revenue" numeric(18,6) DEFAULT 0 NOT NULL,
  "fee" numeric(18,6) DEFAULT 0 NOT NULL, "settled_at" timestamp with time zone NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL, "observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "official_settlements_key_idx" ON "official_settlements" ("settlement_key");
CREATE INDEX IF NOT EXISTS "official_settlements_market_idx" ON "official_settlements" ("market_id");
CREATE INDEX IF NOT EXISTS "official_settlements_time_idx" ON "official_settlements" ("settled_at");

CREATE TABLE IF NOT EXISTS "official_sync_state" (
  "platform" "platform" NOT NULL, "account_scope" varchar(100) DEFAULT 'default' NOT NULL,
  "resource" varchar(50) NOT NULL, "cursor" text, "last_venue_time" timestamp with time zone,
  "last_success_at" timestamp with time zone, "last_error" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "official_sync_state_platform_account_scope_resource_pk" PRIMARY KEY("platform", "account_scope", "resource")
);
