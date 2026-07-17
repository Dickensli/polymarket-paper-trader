ALTER TABLE "paper_trade_orders" ADD COLUMN "report_id" uuid;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD COLUMN "report_id" uuid;--> statement-breakpoint
ALTER TABLE "paper_trade_orders" ADD CONSTRAINT "paper_trade_orders_report_id_agent_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."agent_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_report_id_agent_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."agent_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paper_trade_orders_report_idx" ON "paper_trade_orders" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "paper_trades_report_idx" ON "paper_trades" USING btree ("report_id");