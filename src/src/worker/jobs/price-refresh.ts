import cron from 'node-cron';
import { getDb } from '@/lib/db';
import { positions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getMidpoint } from '@/lib/polymarket';
import { getKalshiOutcomePrice } from '@/lib/kalshi';
import {
  getPolymarketUsOutcomePrice,
  parsePolymarketUsTokenId,
} from '@/lib/polymarket-us';
import { Redis } from '@upstash/redis';

/**
 * Detect whether a tokenId is a Kalshi ticker.
 * Kalshi tickers start with "KX" (e.g. KXBTC15M-26JUL091115-15).
 */
function parseKalshiPosition(
  tokenId: string,
  fallbackOutcome: string,
): { ticker: string; outcome: 'YES' | 'NO' } | null {
  const canonical = /^kalshi:(KX.+):(YES|NO)$/.exec(tokenId);
  if (canonical) return { ticker: canonical[1], outcome: canonical[2] as 'YES' | 'NO' };

  const legacy = /^(KX[^:]+):(YES|NO)$/.exec(tokenId);
  if (legacy) return { ticker: legacy[1], outcome: legacy[2] as 'YES' | 'NO' };

  if (tokenId.startsWith('KX') && (fallbackOutcome === 'YES' || fallbackOutcome === 'NO')) {
    return { ticker: tokenId, outcome: fallbackOutcome };
  }
  return null;
}



/**
 * Runs a single iteration of the price refresh job.
 * Handles Polymarket (CLOB midpoint), Kalshi (public market API), and Polymarket US positions.
 */
export async function runPriceRefresh() {
  const db = getDb();
  
  // 1. Get all active open positions
  const openPositions = await db.query.positions.findMany({
    where: eq(positions.isOpen, true)
  });

  if (openPositions.length === 0) return 0;

  const redis = process.env.UPSTASH_REDIS_REST_URL ? Redis.fromEnv() : null;

  // 2. Group positions by type and fetch prices
  const polymarketTokenIds = Array.from(new Set(
    openPositions
      .filter((p) => !parseKalshiPosition(p.tokenId, p.outcome))
      .filter((p) => p.platform !== 'polymarket_us' && !parsePolymarketUsTokenId(p.tokenId))
      .map((p) => p.tokenId)
  ));

  const kalshiKeys = Array.from(new Map(
    openPositions.flatMap((position) => {
      const parsed = parseKalshiPosition(position.tokenId, position.outcome);
      if (!parsed) return [];
      const key = `${position.tokenId}:${parsed.outcome}`;
      return [[key, { storedTokenId: position.tokenId, ...parsed }] as const];
    }),
  ).values());

  const polymarketUsKeys = Array.from(new Map(
    openPositions.flatMap((position) => {
      if (parseKalshiPosition(position.tokenId, position.outcome)) return [];
      const parsed = parsePolymarketUsTokenId(position.tokenId);
      if (!parsed && position.platform !== 'polymarket_us') return [];
      const slug = parsed?.slug ?? position.marketId;
      const outcome = parsed?.outcome ?? position.outcome;
      if (!slug || (outcome !== 'YES' && outcome !== 'NO')) return [];
      const key = `${slug}\u0000${outcome}`;
      return [[key, { storedTokenId: position.tokenId, slug, outcome }] as const];
    }),
  ).values());

  // Fetch Polymarket prices
  const polyPrices = await Promise.all(
    polymarketTokenIds.map(async (tokenId) => {
      const mid = await getMidpoint(tokenId).catch(() => null);
      return { tokenId, midpoint: mid };
    })
  );

  // Fetch Kalshi prices (public API, no API key needed)
  const kalshiPrices = await Promise.all(
    kalshiKeys.map(async ({ storedTokenId, ticker, outcome }) => {
      // Mark an existing long at executable liquidation value, never at the
      // higher BUY ask. This keeps paper NAV and graduation conservative.
      const price = await getKalshiOutcomePrice(ticker, outcome, 'SELL').catch(() => null);
      return { storedTokenId, outcome, midpoint: price };
    })
  );

  const polymarketUsPrices = await Promise.all(
    polymarketUsKeys.map(async ({ storedTokenId, slug, outcome }) => {
      const price = await getPolymarketUsOutcomePrice(slug, outcome, 'MARK').catch(() => null);
      return { storedTokenId, outcome, midpoint: price };
    }),
  );

  // 3. Update DB and Cache — Polymarket positions
  for (const { tokenId, midpoint } of polyPrices) {
    if (midpoint === null || typeof midpoint !== 'number') continue;

    if (redis) {
      await redis.set(`price:${tokenId}`, midpoint, { ex: 30 }).catch(() => {});
    }

    await db
      .update(positions)
      .set({ currentPrice: midpoint.toFixed(6), updatedAt: new Date() })
      .where(eq(positions.tokenId, tokenId));
  }

  // 4. Update DB and Cache — Kalshi positions
  for (const { storedTokenId, outcome, midpoint } of kalshiPrices) {
    if (midpoint === null || typeof midpoint !== 'number') continue;

    if (redis) {
      await redis.set(`price:${storedTokenId}:${outcome}`, midpoint, { ex: 30 }).catch(() => {});
    }

    await db
      .update(positions)
      .set({ currentPrice: midpoint.toFixed(6), updatedAt: new Date() })
      .where(and(eq(positions.tokenId, storedTokenId), eq(positions.outcome, outcome)));
  }

  // 5. Update Polymarket US positions from the US venue, never the
  // international Polymarket CLOB token endpoint.
  for (const { storedTokenId, outcome, midpoint } of polymarketUsPrices) {
    if (midpoint === null || typeof midpoint !== 'number') continue;

    if (redis) {
      await redis.set(`price:${storedTokenId}:${outcome}`, midpoint, { ex: 30 }).catch(() => {});
    }
    await db
      .update(positions)
      .set({ currentPrice: midpoint.toFixed(6), updatedAt: new Date() })
      .where(and(eq(positions.tokenId, storedTokenId), eq(positions.outcome, outcome)));
  }
  
  return polymarketTokenIds.length + kalshiKeys.length + polymarketUsKeys.length;
}

export function startPriceRefreshJob() {
  cron.schedule('*/30 * * * * *', async () => {
    try {
      const count = await runPriceRefresh();
      console.log(`[Worker] Price refresh complete: ${count} tokens updated`);
    } catch (err) {
      console.error('[Worker] Price refresh failed:', err);
    }
  });
}
