ALTER TABLE "leaderboard_snapshots" ADD COLUMN IF NOT EXISTS "platform" "platform" NOT NULL DEFAULT 'polymarket';
CREATE INDEX IF NOT EXISTS "leaderboard_platform_idx" ON "leaderboard_snapshots" USING btree ("platform");
