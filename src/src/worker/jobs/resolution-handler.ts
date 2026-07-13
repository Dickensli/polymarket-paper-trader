import cron from 'node-cron';
import { getDb } from '@/lib/db';
import { positions, portfolios, paperTrades } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getMarket } from '@/lib/polymarket';
import { getKalshiMarket } from '@/lib/kalshi';
import { getPolymarketUsMarketSettlement } from '@/lib/polymarket-us';
import { cancelAllOrders } from '@/lib/limit-orders';
import { inferPositionPlatform, type PositionPlatform } from '@/lib/position-platform';

type OpenPosition = {
  id: string; userId: string; portfolioId: string; platform?: PositionPlatform;
  marketId: string; marketQuestion: string | null; tokenId: string; outcome: string;
  shares: string; avgEntryPrice: string; realizedPnl: string;
};
type Resolution =
  | { type: 'resolved'; winningTokenId: string }
  | { type: 'priced'; yesPrice: number }
  | { type: 'voided' }
  | { type: 'pending' };

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
  pos: OpenPosition,
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
        closedAt: new Date(),
        closeReason: settlementType === 'VOIDED' ? 'VOIDED' : 'SETTLED',
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
      platform: inferPositionPlatform(pos),
      idempotencyKey: `resolve_${pos.id}_${Date.now()}`,
    });
  });
}

async function readResolution(platform: PositionPlatform, marketId: string): Promise<Resolution> {
  if (platform === 'kalshi') {
    const market = await getKalshiMarket(marketId).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, market ? 150 : 500));
    if (!market) return { type: 'pending' };
    const status = String(market.status).toLowerCase();
    if (status !== 'finalized' && status !== 'settled') return { type: 'pending' };
    const result = String(market.result).toUpperCase();
    return result === 'YES' || result === 'NO' ? { type: 'resolved', winningTokenId: result } : { type: 'voided' };
  }
  if (platform === 'polymarket_us') {
    const settlement = await getPolymarketUsMarketSettlement(marketId);
    if (!settlement) return { type: 'pending' };
    const rawPrice = Number(settlement.settlementPrice?.value);
    if (!Number.isFinite(rawPrice)) return { type: 'pending' };
    return { type: 'priced', yesPrice: rawPrice > 1 ? rawPrice / 100 : rawPrice };
  }
  const market = await getMarket(marketId).catch(() => null);
  return market?.closed ? determineResolution(market) : { type: 'pending' };
}

async function settleOpenPositions(openPositions: OpenPosition[]): Promise<number> {
  const groups = new Map<string, OpenPosition[]>();
  for (const position of openPositions) {
    const key = `${inferPositionPlatform(position)}\u0000${position.marketId}`;
    groups.set(key, [...(groups.get(key) ?? []), position]);
  }
  let resolvedCount = 0;
  for (const [key, marketPositions] of groups) {
    const [platform, marketId] = key.split('\u0000') as [PositionPlatform, string];
    try {
      const resolution = await readResolution(platform, marketId);
      if (resolution.type === 'pending') continue;
      for (const position of marketPositions) {
        try {
          if (resolution.type === 'voided') {
            await settlePosition(position, Number(position.avgEntryPrice), 'VOIDED');
          } else {
            const exitPrice = resolution.type === 'priced'
              ? (position.outcome.toUpperCase() === 'NO' ? 1 - resolution.yesPrice : resolution.yesPrice)
              : (platform === 'kalshi'
                  ? Number(position.outcome.toUpperCase() === resolution.winningTokenId)
                  : Number(position.tokenId === resolution.winningTokenId));
            await settlePosition(position, exitPrice, 'RESOLVED');
          }
          resolvedCount += 1;
        } catch (error) {
          console.error(`[Resolution] Error settling position ${position.id}:`, error);
        }
      }
      for (const userId of new Set(marketPositions.map((position) => position.userId))) {
        await cancelAllOrders(userId, marketId);
      }
    } catch (error) {
      console.error(`[Resolution] Error resolving ${platform}:${marketId}:`, error);
    }
  }
  return resolvedCount;
}

export async function runResolutionCheckForUser(userId: string): Promise<number> {
  const db = getDb();
  const openPositions = await db.query.positions.findMany({
    where: and(eq(positions.isOpen, true), eq(positions.userId, userId)),
  });
  return settleOpenPositions(openPositions as OpenPosition[]);
}

export async function runResolutionCheck(): Promise<number> {
  const db = getDb();
  const openPositions = await db.query.positions.findMany({ where: eq(positions.isOpen, true) });
  return settleOpenPositions(openPositions as OpenPosition[]);
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
