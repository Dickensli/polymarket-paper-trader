CREATE TABLE IF NOT EXISTS "strategy_capital_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL REFERENCES "strategies"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"amount" numeric(18, 6) NOT NULL,
	"nav_before_flow" numeric(18, 6) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" varchar(30) DEFAULT 'manual' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_capital_flows_nonzero" CHECK ("amount" <> 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "strategy_capital_flows_idempotency_idx"
	ON "strategy_capital_flows" ("strategy_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "strategy_capital_flows_strategy_time_idx"
	ON "strategy_capital_flows" ("strategy_id", "occurred_at");

ALTER TABLE "strategy_capital_flows" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "strategy_capital_flows" FROM anon, authenticated;

COMMENT ON TABLE "strategy_capital_flows" IS
	'Rare strategy-level aggregate capital contributions and withdrawals; no trade or market event detail.';
