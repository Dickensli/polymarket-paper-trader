CREATE TABLE IF NOT EXISTS "strategy_performance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL REFERENCES "strategies"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"platform" "platform" NOT NULL,
	"agent_mode" "agent_mode" NOT NULL,
	"bucket" varchar(10) NOT NULL,
	"bucket_at" timestamp with time zone NOT NULL,
	"cash" numeric(18, 6) NOT NULL,
	"positions_value" numeric(18, 6) NOT NULL,
	"nav" numeric(18, 6) NOT NULL,
	"pnl" numeric(18, 6) NOT NULL,
	"return_pct" numeric(14, 6) NOT NULL,
	"period_return_pct" numeric(14, 6) DEFAULT '0' NOT NULL,
	"twr_pct" numeric(14, 6) NOT NULL,
	"mwr_pct" numeric(14, 6),
	"net_external_flow" numeric(18, 6) DEFAULT '0' NOT NULL,
	"unpriced_positions_count" integer DEFAULT 0 NOT NULL,
	"pricing_updated_at" timestamp with time zone,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_performance_bucket_check" CHECK ("bucket" IN ('HOURLY', 'DAILY'))
);

ALTER TABLE "strategy_performance_snapshots"
	ADD COLUMN IF NOT EXISTS "unpriced_positions_count" integer DEFAULT 0 NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "strategy_performance_bucket_unique_idx"
	ON "strategy_performance_snapshots" ("strategy_id", "bucket", "bucket_at");
CREATE INDEX IF NOT EXISTS "strategy_performance_strategy_time_idx"
	ON "strategy_performance_snapshots" ("strategy_id", "bucket", "bucket_at");
CREATE INDEX IF NOT EXISTS "strategy_performance_segment_time_idx"
	ON "strategy_performance_snapshots" ("platform", "agent_mode", "bucket", "bucket_at");

ALTER TABLE "strategy_performance_snapshots" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "strategy_performance_snapshots" FROM anon, authenticated;

COMMENT ON TABLE "strategy_performance_snapshots" IS
	'Compact hourly/daily strategy NAV and returns only; no granular positions, orders, or event payloads.';
