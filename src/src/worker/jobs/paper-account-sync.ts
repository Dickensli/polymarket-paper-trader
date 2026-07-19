import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  portfolioSnapshots,
  strategies,
  portfolios,
  positions,
  paperTradeOrders,
} from '@/lib/db/schema';

export type PaperAccountSyncResult = {
  strategies_synced: number;
  errors: Array<{ strategyId: string; message: string }>;
};

export async function runPaperAccountSync(): Promise<PaperAccountSyncResult> {
  const db = getDb();
  const result: PaperAccountSyncResult = {
    strategies_synced: 0,
    errors: [],
  };

  try {
    // 1. Get all active paper strategies
    const activePaperStrats = await db.query.strategies.findMany({
      where: and(eq(strategies.agentMode, 'paper'), eq(strategies.status, 'active')),
    });

    for (const strategy of activePaperStrats) {
      try {
        // 2. Fetch portfolio balance
        const portfolio = await db.query.portfolios.findFirst({
          where: eq(portfolios.userId, strategy.userId),
        });

        const cash = portfolio ? Number(portfolio.balance) : 10000;
        const initialBalance = portfolio ? Number(portfolio.initialBalance) : 10000;

        // 3. Fetch open positions
        const openPositions = await db.query.positions.findMany({
          where: and(eq(positions.userId, strategy.userId), eq(positions.isOpen, true)),
        });

        // 4. Calculate positions value and format them for snapshot
        let positionsValue = 0;
        const currentPositions = openPositions.map((pos) => {
          const shares = Number(pos.shares);
          const storedPrice = Number(pos.currentPrice);
          const pricingUpdatedAt = pos.updatedAt.toISOString();
          const pricingStatus = Number.isFinite(storedPrice)
            && storedPrice > 0
            && Date.now() - pos.updatedAt.getTime() <= 10 * 60 * 1000
            ? 'priced' as const
            : 'unpriced' as const;
          const currentPrice = pricingStatus === 'priced' ? storedPrice : 0;
          positionsValue += shares * currentPrice;
          return {
            id: pos.id,
            marketId: pos.marketId,
            marketQuestion: pos.marketQuestion,
            tokenId: pos.tokenId,
            outcome: pos.outcome,
            shares,
            avgEntryPrice: Number(pos.avgEntryPrice),
            currentPrice,
            pricing_status: pricingStatus,
            pricing_updated_at: pricingUpdatedAt,
            unrealizedPnL: shares * (currentPrice - Number(pos.avgEntryPrice)),
          };
        });

        // 5. Fetch open paper orders (pending)
        const pendingOrders = await db.query.paperTradeOrders.findMany({
          where: and(eq(paperTradeOrders.userId, strategy.userId), eq(paperTradeOrders.status, 'PENDING')),
        });

        const totalValue = cash + positionsValue;
        const pnl = totalValue - initialBalance;

        // 6. Insert new portfolio snapshot
        await db.insert(portfolioSnapshots).values({
          strategyId: strategy.id,
          userId: strategy.userId,
          platform: strategy.platform,
          agentMode: strategy.agentMode,
          source: 'local',
          cash: cash.toFixed(2),
          positionsValue: positionsValue.toFixed(2),
          totalValue: totalValue.toFixed(2),
          pnl: pnl.toFixed(6),
          positions: currentPositions,
          orders: pendingOrders,
        });

        result.strategies_synced++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({
          strategyId: strategy.id,
          message: `Failed to sync paper strategy "${strategy.strategyId}": ${msg}`,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push({
      strategyId: 'ALL',
      message: `Failed to retrieve active paper strategies: ${msg}`,
    });
  }

  return result;
}
