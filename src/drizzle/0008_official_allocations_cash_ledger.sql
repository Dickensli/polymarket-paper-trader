CREATE TABLE IF NOT EXISTS "official_settlement_allocations" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "settlement_id" uuid NOT NULL REFERENCES "official_settlements"("id") ON DELETE cascade,
 "strategy_id" uuid NOT NULL REFERENCES "strategies"("id") ON DELETE cascade, "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
 "outcome" "outcome" NOT NULL, "quantity" numeric(18,6) NOT NULL, "cost_basis" numeric(18,6) NOT NULL,
 "proceeds" numeric(18,6) NOT NULL, "settlement_fee" numeric(18,6) DEFAULT 0 NOT NULL, "realized_pnl" numeric(18,6) NOT NULL,
 "allocation_method" varchar(100) DEFAULT 'attributed_lots_v1' NOT NULL, "allocation_version" integer DEFAULT 1 NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "official_settlement_allocations_unique_idx" ON "official_settlement_allocations" ("settlement_id","strategy_id","outcome");
CREATE INDEX IF NOT EXISTS "official_settlement_allocations_strategy_idx" ON "official_settlement_allocations" ("strategy_id");
CREATE TABLE IF NOT EXISTS "official_cash_ledger_entries" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "platform" "platform" NOT NULL, "account_scope" varchar(100) DEFAULT 'default' NOT NULL,
 "strategy_id" uuid REFERENCES "strategies"("id") ON DELETE set null, "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
 "entry_key" varchar(512) NOT NULL, "entry_group" varchar(512) NOT NULL, "source_type" varchar(50) NOT NULL, "source_id" varchar(255) NOT NULL,
 "account_type" varchar(50) NOT NULL, "amount" numeric(18,6) NOT NULL, "occurred_at" timestamp with time zone NOT NULL,
 "payload" jsonb DEFAULT '{}'::jsonb NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "official_cash_ledger_entries_key_idx" ON "official_cash_ledger_entries" ("entry_key");
CREATE INDEX IF NOT EXISTS "official_cash_ledger_entries_group_idx" ON "official_cash_ledger_entries" ("entry_group");
CREATE INDEX IF NOT EXISTS "official_cash_ledger_entries_strategy_idx" ON "official_cash_ledger_entries" ("strategy_id");
