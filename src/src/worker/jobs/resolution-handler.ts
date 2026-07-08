import cron from 'node-cron';
import { getDb } from '@/lib/db';
import { positions, portfolios, paperTrades } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getMarket } from '@/lib/polymarket';
import { getKalshiMarket } from '@/lib/kalshi';
import { cancelAllOrders } from '@/lib/limit-orders';

/**
 * Determine the resolution outcome for a closed market.
 * Returns:
 *  - { type: 'resolved', winningTokenId: string } — one outcome won
 *  - { type: 'voided' }   — market was cancelled / voided (refund at cost basis)
 *  - { type: 'pending' }  — market is closed but resolution data isn't available yet
 */
function determineResolution(
  market: { closed: boolean; tokenIds: string[]; outcomePrices: number[] },
): { type: 'resolved'; winningTokenId: string } | { type: 'voided' } | { type: 'pending' } {
  if (!market.closed) return { type: 'pending' };

  // Check if any outcome has price >= 0.99 (clear winner)
  const winningIndex = market.outcomePrices.findIndex(p => p === 1 || p >= 0.99);
  if (winningIndex !== -1 && market.tokenIds[winningIndex]) {
    return { type: 'resolved', winningTokenId: market.tokenIds[winningIndex] };
  }

  // Market is closed but no clear winner.
  // Check if ALL prices are near 0 (truly voided) or near equal (cancelled/refunded).
  const allNearZero = market.outcomePrices.every(p => p <= 0.01);
  const allEqual = market.outcomePrices.length > 0 &&
    market.outcomePrices.every(p => Math.abs(p - market.outcomePrices[0]) < 0.05);

  if (allNearZero || allEqual) {
    // This is a voided/cancelled market — refund positions at cost basis
    return { type: 'voided' };
  }

  // Market is closed but resolution data might not be fully propagated yet
  return { type: 'pending' };
}

/**
 * Settle a single position based on resolution outcome.
 */
async function settlePosition(
  pos: {
    id: string;
    userId: string;
    portfolioId: string;
    marketId: string;
    marketQuestion: string | null;
    tokenId: string;
    outcome: string;
    shares: string;
    avgEntryPrice: string;
    realizedPnl: string;
  },
  exitPrice: number,
  settlementType: 'RESOLVED' | 'VOIDED',
) {
  const db = getDb();
  const sharesNum = Number(pos.shares);
  const avgEntry = Number(pos.avgEntryPrice);
  const prevRealizedPnl = Number(pos.realizedPnl) || 0;
  const pnl = (exitPrice - avgEntry) * sharesNum;
  const totalRealizedPnl = prevRealizedPnl + pnl;
  const proceeds = sharesNum * exitPrice;

  await db.transaction(async (tx) => {
    // Close position
    await tx
      .update(positions)
      .set({
        isOpen: false,
        currentPrice: exitPrice.toFixed(6),
        realizedPnl: totalRealizedPnl.toFixed(6),
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, pos.id));

    // Credit portfolio with proceeds (if any)
    if (proceeds > 0) {
      const [portfolio] = await tx
        .select()
        .from(portfolios)
        .where(eq(portfolios.id, pos.portfolioId))
        .for('update');
      if (portfolio) {
        const newBalance = Number(portfolio.balance) + proceeds;
        await tx
          .update(portfolios)
          .set({ balance: newBalance.toFixed(2), updatedAt: new Date() })
          .where(eq(portfolios.id, portfolio.id));
      }
    }

    // Record settling trade
    const description =
      settlementType === 'VOIDED'
        ? `Market voided — refund at cost basis`
        : `Market resolved — settlement`;

    await tx.insert(paperTrades).values({
      userId: pos.userId,
      portfolioId: pos.portfolioId,
      marketId: pos.marketId,
      marketQuestion: pos.marketQuestion,
      tokenId: pos.tokenId,
      outcome: pos.outcome as 'YES' | 'NO',
      action: 'SELL',
      shares: pos.shares,
      pricePerShare: exitPrice.toFixed(6),
      totalCost: proceeds.toFixed(2),
      status: 'FILLED',
      idempotencyKey: `resolve_${pos.id}_${Date.now()}`,
    });
  });
}

/**
 * Checks for closed/resolved markets and settles positions for a specific user.
 */
export async function runResolutionCheckForUser(userId: string): Promise<number> {
  const db = getDb();

  // Find all active open positions for this specific user
  const openPositions = await db.query.positions.findMany({
    where: and(
      eq(positions.isOpen, true),
      eq(positions.userId, userId)
    )
  });

  if (openPositions.length === 0) return 0;

  const uniqueMarketIds = Array.from(new Set(openPositions.map(p => p.marketId)));
  let resolvedCount = 0;

  for (const marketId of uniqueMarketIds) {
    try {
      // Determine platform from open positions
      const marketPositions = openPositions.filter(p => p.marketId === marketId);
      const isKalshi = marketPositions.some(p => p.tokenId.startsWith('kalshi:'));

      let resolution: { type: 'resolved'; winningTokenId: string } | { type: 'voided' } | { type: 'pending' } = { type: 'pending' };

      if (isKalshi) {
        const market = await getKalshiMarket(marketId).catch(() => null);
        if (!market) continue;
        const status = String(market.status).toLowerCase();
        if (status === 'finalized' || status === 'settled') {
          const result = String(market.result).toLowerCase();
          if (result === 'yes') {
            resolution = { type: 'resolved', winningTokenId: `kalshi:${marketId}:YES` };
          } else if (result === 'no') {
            resolution = { type: 'resolved', winningTokenId: `kalshi:${marketId}:NO` };
          } else {
            resolution = { type: 'voided' };
          }
        }
      } else {
        const market = await getMarket(marketId).catch(() => null);
        if (!market || !market.closed) continue;
        resolution = determineResolution(market);
      }

      if (resolution.type === 'pending') continue;

      for (const pos of marketPositions) {
        try {
          if (resolution.type === 'resolved') {
            // Winner gets $1/share, loser gets $0/share
            const exitPrice = pos.tokenId === resolution.winningTokenId ? 1 : 0;
            await settlePosition(pos, exitPrice, 'RESOLVED');
          } else {
            // Voided: refund at avg entry price (break-even)
            const exitPrice = Number(pos.avgEntryPrice);
            await settlePosition(pos, exitPrice, 'VOIDED');
          }
          resolvedCount++;
        } catch (err) {
          console.error(`[Resolution] Error settling position ${pos.id} for user ${userId}:`, err);
        }
      }

      // Cancel any pending limit orders for this resolved market
      try {
        const userIds = new Set(marketPositions.map(p => p.userId));
        for (const uid of userIds) {
          await cancelAllOrders(uid, marketId);
        }
      } catch (err) {
        console.error(`[Resolution] Error cancelling limit orders for market ${marketId}:`, err);
      }
    } catch (err) {
      console.error(`[Resolution] Error resolving market ${marketId} for user ${userId}:`, err);
    }
  }
  
  return resolvedCount;
}

/**
 * Checks for closed/resolved markets and settles ALL users' positions.
 */
export async function runResolutionCheck() {
  const db = getDb();

  // Find all active open positions across all users
  const openPositions = await db.query.positions.findMany({
    where: eq(positions.isOpen, true)
  });

  if (openPositions.length === 0) return 0;

  const uniqueMarketIds = Array.from(new Set(openPositions.map(p => p.marketId)));
  let resolvedCount = 0;

  for (const marketId of uniqueMarketIds) {
    try {
      const marketPositions = openPositions.filter(p => p.marketId === marketId);
      const isKalshi = marketPositions.some(p => p.tokenId.startsWith('kalshi:'));

      let resolution: { type: 'resolved'; winningTokenId: string } | { type: 'voided' } | { type: 'pending' } = { type: 'pending' };

      if (isKalshi) {
        const market = await getKalshiMarket(marketId).catch(() => null);
        if (!market) continue;
        const status = String(market.status).toLowerCase();
        if (status === 'finalized' || status === 'settled') {
          const result = String(market.result).toLowerCase();
          if (result === 'yes') {
            resolution = { type: 'resolved', winningTokenId: `kalshi:${marketId}:YES` };
          } else if (result === 'no') {
            resolution = { type: 'resolved', winningTokenId: `kalshi:${marketId}:NO` };
          } else {
            resolution = { type: 'voided' };
          }
        }
      } else {
        const market = await getMarket(marketId).catch(() => null);
        if (!market || !market.closed) continue;
        resolution = determineResolution(market);
      }

      if (resolution.type === 'pending') continue;

      for (const pos of marketPositions) {
        try {
          if (resolution.type === 'resolved') {
            const exitPrice = pos.tokenId === resolution.winningTokenId ? 1 : 0;
            await settlePosition(pos, exitPrice, 'RESOLVED');
          } else {
            // Voided: refund at avg entry price
            const exitPrice = Number(pos.avgEntryPrice);
            await settlePosition(pos, exitPrice, 'VOIDED');
          }
          resolvedCount++;
        } catch (err) {
          console.error(`[Worker] Error settling position ${pos.id}:`, err);
        }
      }

      // Cancel any pending limit orders for this resolved market
      try {
        const userIds = new Set(marketPositions.map(p => p.userId));
        for (const uid of userIds) {
          await cancelAllOrders(uid, marketId);
        }
      } catch (err) {
        console.error(`[Resolution] Error cancelling limit orders for market ${marketId}:`, err);
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
