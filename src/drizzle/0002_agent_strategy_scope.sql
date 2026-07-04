DROP INDEX IF EXISTS "strategies_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_unique_idx" ON "strategies" USING btree ("user_id","strategy_id","agent_mode","platform");
