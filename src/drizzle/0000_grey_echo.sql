CREATE TYPE "public"."agent_mode" AS ENUM('paper', 'real');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'FILLED', 'CANCELLED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('YES', 'NO');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('polymarket', 'kalshi', 'polymarket_us');--> statement-breakpoint
CREATE TYPE "public"."strategy_status" AS ENUM('active', 'paused', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."trade_action" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(255) NOT NULL,
	"provider" varchar(255) NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" varchar(255),
	"scope" varchar(255),
	"id_token" text,
	"session_state" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "agent_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid,
	"run_id" uuid,
	"user_id" uuid NOT NULL,
	"account" varchar(255) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"title" varchar(255),
	"lessons_learned" text,
	"next_steps" text,
	"portfolio_summary" jsonb DEFAULT '{}'::jsonb,
	"trade_summary" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_cache" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"ticker" varchar(255),
	"slug" varchar(255),
	"title" text,
	"description" text,
	"start_date" timestamp with time zone,
	"creation_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"image" text,
	"icon" text,
	"active" boolean DEFAULT true,
	"closed" boolean DEFAULT false,
	"archived" boolean DEFAULT false,
	"mutually_exclusive" boolean DEFAULT false,
	"category" varchar(255),
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_name" varchar(255),
	"total_pnl" numeric(18, 6) NOT NULL,
	"return_pct" numeric(10, 4) NOT NULL,
	"portfolio_value" numeric(18, 6) NOT NULL,
	"rank" integer NOT NULL,
	"period" varchar(50) NOT NULL,
	"snapshot_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trade_id" uuid,
	"account_type" varchar(50) NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"balance_after" numeric(18, 6),
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "limit_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"market_id" varchar(255) NOT NULL,
	"market_question" text,
	"token_id" varchar(255) NOT NULL,
	"outcome" "outcome" NOT NULL,
	"side" "trade_action" NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"limit_price" numeric(18, 6) NOT NULL,
	"order_type" varchar(20) DEFAULT 'GTC' NOT NULL,
	"expires_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"filled_at" timestamp with time zone,
	"filled_trade_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_cache" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"event_id" varchar(255),
	"question" text,
	"condition_id" varchar(255),
	"outcomes" jsonb,
	"outcome_prices" jsonb,
	"token_ids" jsonb,
	"volume_24hr" numeric(18, 2),
	"liquidity" numeric(18, 2),
	"category" varchar(255),
	"image" text,
	"icon" text,
	"closed" boolean DEFAULT false,
	"active" boolean DEFAULT true,
	"end_date" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_trade_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid,
	"paper_trade_id" uuid,
	"platform" "platform" NOT NULL,
	"market_id" varchar(255) NOT NULL,
	"market_slug" varchar(500),
	"outcome" "outcome" NOT NULL,
	"side" "trade_action" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"notional" numeric(18, 2) NOT NULL,
	"fill_model" varchar(50) DEFAULT 'paper_midpoint' NOT NULL,
	"status" "order_status" DEFAULT 'FILLED' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request" jsonb DEFAULT '{}'::jsonb,
	"result" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid,
	"run_id" uuid,
	"user_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"market_id" varchar(255) NOT NULL,
	"market_question" text,
	"token_id" varchar(255) NOT NULL,
	"platform" "platform" DEFAULT 'polymarket',
	"outcome" "outcome" NOT NULL,
	"action" "trade_action" NOT NULL,
	"shares" numeric(18, 6) NOT NULL,
	"price_per_share" numeric(18, 6) NOT NULL,
	"total_cost" numeric(18, 2) NOT NULL,
	"slippage_applied" numeric(18, 6) DEFAULT '0.000000',
	"idempotency_key" varchar(64) DEFAULT '' NOT NULL,
	"metadata" jsonb,
	"status" "order_status" DEFAULT 'FILLED' NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid,
	"user_id" uuid NOT NULL,
	"run_id" uuid,
	"platform" "platform",
	"agent_mode" "agent_mode",
	"source" varchar(20) DEFAULT 'local' NOT NULL,
	"cash" numeric(18, 2) NOT NULL,
	"positions_value" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"total_value" numeric(18, 2) NOT NULL,
	"pnl" numeric(18, 6) DEFAULT '0.000000' NOT NULL,
	"positions" jsonb DEFAULT '[]'::jsonb,
	"orders" jsonb DEFAULT '[]'::jsonb,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" numeric(18, 2) DEFAULT '10000.00' NOT NULL,
	"initial_balance" numeric(18, 2) DEFAULT '10000.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"market_id" varchar(255) NOT NULL,
	"market_question" text,
	"token_id" varchar(255) NOT NULL,
	"outcome" "outcome" NOT NULL,
	"shares" numeric(18, 6) NOT NULL,
	"avg_entry_price" numeric(18, 6) NOT NULL,
	"current_price" numeric(18, 6) DEFAULT '0.5' NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"realized_pnl" numeric(18, 6) DEFAULT '0.000000' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "real_trade_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid,
	"platform" "platform" NOT NULL,
	"official_order_id" varchar(255),
	"client_order_id" varchar(255),
	"market_id" varchar(255),
	"market_slug_or_ticker" varchar(500),
	"side" "trade_action" NOT NULL,
	"quantity" numeric(18, 6),
	"price" numeric(18, 6),
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"request" jsonb DEFAULT '{}'::jsonb,
	"official_response" jsonb DEFAULT '{}'::jsonb,
	"error" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid,
	"platform" "platform" NOT NULL,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"difference_type" varchar(50) DEFAULT 'unknown' NOT NULL,
	"official_snapshot" jsonb DEFAULT '{}'::jsonb,
	"local_snapshot" jsonb DEFAULT '{}'::jsonb,
	"diff" jsonb DEFAULT '{}'::jsonb,
	"threshold" jsonb DEFAULT '{}'::jsonb,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_name" varchar(255) NOT NULL,
	"agent_mode" "agent_mode" DEFAULT 'paper' NOT NULL,
	"platform" "platform" DEFAULT 'polymarket' NOT NULL,
	"status" "strategy_status" DEFAULT 'active' NOT NULL,
	"starting_balance" numeric(18, 2) DEFAULT '10000.00' NOT NULL,
	"risk_config" jsonb DEFAULT '{}'::jsonb,
	"schedule" varchar(100),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"trigger_id" varchar(255),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"input_context" jsonb,
	"summary" text,
	"error" text,
	"trades_executed" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"image" text,
	"email_verified" timestamp with time zone,
	"settings" jsonb DEFAULT '{"defaultTradeSize":100,"slippageEnabled":false,"slippageBps":50,"theme":"system","notifications":true}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reports" ADD CONSTRAINT "agent_reports_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reports" ADD CONSTRAINT "agent_reports_run_id_strategy_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."strategy_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reports" ADD CONSTRAINT "agent_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_trade_id_paper_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."paper_trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_orders" ADD CONSTRAINT "limit_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_orders" ADD CONSTRAINT "limit_orders_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_orders" ADD CONSTRAINT "limit_orders_filled_trade_id_paper_trades_id_fk" FOREIGN KEY ("filled_trade_id") REFERENCES "public"."paper_trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_cache" ADD CONSTRAINT "market_cache_event_id_event_cache_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_cache"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trade_orders" ADD CONSTRAINT "paper_trade_orders_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trade_orders" ADD CONSTRAINT "paper_trade_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trade_orders" ADD CONSTRAINT "paper_trade_orders_run_id_strategy_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."strategy_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trade_orders" ADD CONSTRAINT "paper_trade_orders_paper_trade_id_paper_trades_id_fk" FOREIGN KEY ("paper_trade_id") REFERENCES "public"."paper_trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_run_id_strategy_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."strategy_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_run_id_strategy_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."strategy_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_trade_orders" ADD CONSTRAINT "real_trade_orders_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_trade_orders" ADD CONSTRAINT "real_trade_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_trade_orders" ADD CONSTRAINT "real_trade_orders_run_id_strategy_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."strategy_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_logs" ADD CONSTRAINT "reconciliation_logs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_logs" ADD CONSTRAINT "reconciliation_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_logs" ADD CONSTRAINT "reconciliation_logs_run_id_strategy_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."strategy_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_runs" ADD CONSTRAINT "strategy_runs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_runs" ADD CONSTRAINT "strategy_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_idx" ON "accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "agent_reports_strategy_idx" ON "agent_reports" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "agent_reports_run_idx" ON "agent_reports" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_reports_user_idx" ON "agent_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_reports_account_idx" ON "agent_reports" USING btree ("account");--> statement-breakpoint
CREATE INDEX "agent_reports_created_idx" ON "agent_reports" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_reports_unique_idx" ON "agent_reports" USING btree ("user_id","account","filename");--> statement-breakpoint
CREATE INDEX "event_cache_category_idx" ON "event_cache" USING btree ("category");--> statement-breakpoint
CREATE INDEX "event_cache_slug_idx" ON "event_cache" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "event_cache_synced_idx" ON "event_cache" USING btree ("last_synced_at");--> statement-breakpoint
CREATE INDEX "leaderboard_period_idx" ON "leaderboard_snapshots" USING btree ("period");--> statement-breakpoint
CREATE INDEX "leaderboard_user_idx" ON "leaderboard_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "leaderboard_rank_idx" ON "leaderboard_snapshots" USING btree ("rank");--> statement-breakpoint
CREATE INDEX "ledger_user_idx" ON "ledger_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ledger_trade_idx" ON "ledger_entries" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "ledger_created_idx" ON "ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "limit_orders_user_idx" ON "limit_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "limit_orders_status_idx" ON "limit_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "limit_orders_market_idx" ON "limit_orders" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "market_cache_category_idx" ON "market_cache" USING btree ("category");--> statement-breakpoint
CREATE INDEX "market_cache_synced_idx" ON "market_cache" USING btree ("last_synced_at");--> statement-breakpoint
CREATE INDEX "paper_trade_orders_strategy_idx" ON "paper_trade_orders" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "paper_trade_orders_user_idx" ON "paper_trade_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "paper_trade_orders_run_idx" ON "paper_trade_orders" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "paper_trade_orders_market_idx" ON "paper_trade_orders" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_trade_orders_idempotency_idx" ON "paper_trade_orders" USING btree ("strategy_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "paper_trades_strategy_idx" ON "paper_trades" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "paper_trades_run_idx" ON "paper_trades" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "paper_trades_user_idx" ON "paper_trades" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "paper_trades_portfolio_idx" ON "paper_trades" USING btree ("portfolio_id");--> statement-breakpoint
CREATE INDEX "paper_trades_market_idx" ON "paper_trades" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "paper_trades_executed_idx" ON "paper_trades" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "paper_trades_idempotency_idx" ON "paper_trades" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_strategy_idx" ON "portfolio_snapshots" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_user_idx" ON "portfolio_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_run_idx" ON "portfolio_snapshots" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_captured_idx" ON "portfolio_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolios_user_idx" ON "portfolios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "positions_user_idx" ON "positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "positions_portfolio_idx" ON "positions" USING btree ("portfolio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_unique_idx" ON "positions" USING btree ("user_id","market_id","outcome");--> statement-breakpoint
CREATE INDEX "real_trade_orders_strategy_idx" ON "real_trade_orders" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "real_trade_orders_user_idx" ON "real_trade_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "real_trade_orders_platform_idx" ON "real_trade_orders" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "real_trade_orders_status_idx" ON "real_trade_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "real_trade_orders_official_idx" ON "real_trade_orders" USING btree ("official_order_id");--> statement-breakpoint
CREATE INDEX "reconciliation_logs_strategy_idx" ON "reconciliation_logs" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "reconciliation_logs_user_idx" ON "reconciliation_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reconciliation_logs_platform_idx" ON "reconciliation_logs" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "reconciliation_logs_severity_idx" ON "reconciliation_logs" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "reconciliation_logs_created_idx" ON "reconciliation_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_unique_idx" ON "strategies" USING btree ("strategy_name","agent_mode","platform");--> statement-breakpoint
CREATE INDEX "strategies_user_idx" ON "strategies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "strategies_name_idx" ON "strategies" USING btree ("strategy_name");--> statement-breakpoint
CREATE INDEX "strategies_status_idx" ON "strategies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "strategy_runs_strategy_idx" ON "strategy_runs" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "strategy_runs_user_idx" ON "strategy_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "strategy_runs_status_idx" ON "strategy_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "strategy_runs_started_idx" ON "strategy_runs" USING btree ("started_at");