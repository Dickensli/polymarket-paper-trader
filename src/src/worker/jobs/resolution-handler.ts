import cron from 'node-cron';
import { getDb } from '@/lib/db';
import { positions, portfolios, paperTrades } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getMarket } from '@/lib/polymarket';

/**
 * Checks for closed/resolved markets and settles positions.
 */
export async function runResolutionCheck() {
  const db = getDb();

  // Find all active open positions
  const openPositions = await db.query.positions.findMany({
    where: eq(positions.isOpen, true)
  });

  const uniqueMarketIds = Array.from(new Set(openPositions.map(p => p.marketId)));
  let resolvedCount = 0;

  for (const marketId of uniqueMarketIds) {
    try {
      const market = await getMarket(marketId).catch(() => null);
      if (!market || !market.closed) continue;
      
      // Determine the winning token by finding the one with price exactly 1
      const winningOutcomeIndex = market.outcomePrices.findIndex(p => p === 1 || p >= 0.999);
      if (winningOutcomeIndex === -1) continue; // Not resolved yet or cancelled

      const winningTokenId = market.tokenIds[winningOutcomeIndex];

      // Resolve positions for this market
      const marketPositions = openPositions.filter(p => p.marketId === marketId);
      
      for (const pos of marketPositions) {
        const exitPrice = pos.tokenId === winningTokenId ? 1 : 0;
        
        await db.transaction(async (tx) => {
          // Close position
          await tx
            .update(positions)
            .set({
              isOpen: false,
              currentPrice: exitPrice.toFixed(6),
              updatedAt: new Date(),
            })
            .where(eq(positions.id, pos.id));

          // If winner, credit portfolio
          if (exitPrice === 1) {
            const proceeds = Number(pos.shares) * 1;
            const [portfolio] = await tx.select().from(portfolios).where(eq(portfolios.id, pos.portfolioId)).for('update');
            if (portfolio) {
              const newBalance = Number(portfolio.balance) + proceeds;
              await tx
                .update(portfolios)
                .set({ balance: newBalance.toFixed(2), updatedAt: new Date() })
                .where(eq(portfolios.id, portfolio.id));
            }
          }

          // Record settling trade
          await tx.insert(paperTrades).values({
            userId: pos.userId,
            portfolioId: pos.portfolioId,
            marketId: pos.marketId,
            marketQuestion: pos.marketQuestion,
            tokenId: pos.tokenId,
            outcome: pos.outcome,
            action: 'SELL',
            shares: pos.shares,
            pricePerShare: exitPrice.toFixed(6),
            totalCost: (Number(pos.shares) * exitPrice).toFixed(2),
            status: 'FILLED',
            idempotencyKey: `resolve_${pos.id}_${Date.now()}`
          });
        });
        resolvedCount++;
      }
    } catch (err) {
      console.error(`[Worker] Error resolving market ${marketId}:`, err);
    }
  }
  
  return resolvedCount;
}

export function startResolutionJob() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const count = await runResolutionCheck();
      if (count > 0) console.log(`[Worker] Resolution check complete: ${count} positions settled`);
    } catch (err) {
      console.error('[Worker] Resolution check failed:', err);
    }
  });
}
