ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "risk_group_id" varchar(255);

UPDATE "positions"
SET "risk_group_id" = "market_id"
WHERE "risk_group_id" IS NULL;

CREATE INDEX IF NOT EXISTS "positions_risk_group_idx"
  ON "positions" ("user_id", "risk_group_id");
