ALTER TABLE "agent_reports" RENAME COLUMN "account" TO "strategy_name";--> statement-breakpoint
ALTER TABLE "strategies" RENAME COLUMN "strategy_name" TO "strategy_id";--> statement-breakpoint
DROP INDEX "agent_reports_strategy_idx";--> statement-breakpoint
DROP INDEX "agent_reports_account_idx";--> statement-breakpoint
DROP INDEX "strategies_name_idx";--> statement-breakpoint
DROP INDEX "agent_reports_unique_idx";--> statement-breakpoint
DROP INDEX "strategies_unique_idx";--> statement-breakpoint
CREATE INDEX "agent_reports_strategy_uuid_idx" ON "agent_reports" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "agent_reports_strategy_name_idx" ON "agent_reports" USING btree ("strategy_name");--> statement-breakpoint
CREATE INDEX "strategies_id_idx" ON "strategies" USING btree ("strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_reports_unique_idx" ON "agent_reports" USING btree ("user_id","strategy_name","filename");--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_unique_idx" ON "strategies" USING btree ("user_id","strategy_id","agent_mode","platform");