ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "platform" "platform" DEFAULT 'polymarket' NOT NULL;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "close_reason" varchar(30);

WITH latest_order AS (
  SELECT DISTINCT ON ("user_id", "market_id", "outcome")
    "user_id", "market_id", "outcome", "platform"
  FROM "paper_trade_orders"
  ORDER BY "user_id", "market_id", "outcome", "created_at" DESC
)
UPDATE "positions" AS position
SET "platform" = latest_order."platform"
FROM latest_order
WHERE position."user_id" = latest_order."user_id"
  AND position."market_id" = latest_order."market_id"
  AND position."outcome" = latest_order."outcome";

WITH latest_sell AS (
  SELECT "user_id", "market_id", "outcome", MAX("created_at") AS "closed_at"
  FROM "paper_trade_orders"
  WHERE "side" = 'SELL'
  GROUP BY "user_id", "market_id", "outcome"
)
UPDATE "positions" AS position
SET "closed_at" = latest_sell."closed_at", "close_reason" = 'USER_CLOSED'
FROM latest_sell
WHERE position."user_id" = latest_sell."user_id"
  AND position."market_id" = latest_sell."market_id"
  AND position."outcome" = latest_sell."outcome"
  AND position."is_open" = false
  AND position."resolved_at" IS NULL
  AND position."shares" = 0;

CREATE INDEX IF NOT EXISTS "positions_platform_idx" ON "positions" ("platform");
CREATE INDEX IF NOT EXISTS "positions_closed_idx" ON "positions" ("closed_at");
