CREATE TABLE IF NOT EXISTS "strategy_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "strategy_id" uuid NOT NULL REFERENCES "strategies"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "run_id" uuid REFERENCES "strategy_runs"("id") ON DELETE SET NULL,
  "platform" "platform" NOT NULL,
  "agent_mode" "agent_mode" NOT NULL,
  "market_id" varchar(255) NOT NULL,
  "outcome" "outcome" NOT NULL,
  "side" "trade_action" NOT NULL,
  "proposal" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "server_quote" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(20) NOT NULL,
  "rejection_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "paper_trade_order_id" uuid REFERENCES "paper_trade_orders"("id") ON DELETE SET NULL,
  "real_trade_order_id" uuid REFERENCES "real_trade_orders"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "strategy_decisions_strategy_idx" ON "strategy_decisions" ("strategy_id");
CREATE INDEX IF NOT EXISTS "strategy_decisions_user_idx" ON "strategy_decisions" ("user_id");
CREATE INDEX IF NOT EXISTS "strategy_decisions_status_idx" ON "strategy_decisions" ("status");
CREATE INDEX IF NOT EXISTS "strategy_decisions_created_idx" ON "strategy_decisions" ("created_at");
ALTER TABLE "strategy_decisions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "strategy_decisions" FROM anon, authenticated;
