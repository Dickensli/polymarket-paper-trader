import cron from 'node-cron';
import { getDb } from '@/lib/db';
import { positions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getMidpoint } from '@/lib/polymarket';
import { getKalshiOutcomePrice } from '@/lib/kalshi';
import { Redis } from '@upstash/redis';

/**
 * Detect whether a tokenId is a Kalshi ticker.
 * Kalshi tickers start with "KX" (e.g. KXBTC15M-26JUL091115-15).
 */
function isKalshiTicker(tokenId: string): boolean {
  return tokenId.startsWith('KX');
}

/**
 * Runs a single iteration of the price refresh job.
 * Handles both Polymarket (CLOB midpoint) and Kalshi (public market API) positions.
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
  // For Polymarket: use getMidpoint (public CLOB API)
  // For Kalshi: use getKalshiOutcomePrice (public market API, no auth needed)
  const polymarketTokenIds = Array.from(new Set(
    openPositions.filter(p => !isKalshiTicker(p.tokenId)).map(p => p.tokenId)
  ));

  const kalshiPositions = openPositions.filter(p => isKalshiTicker(p.tokenId));
  // Deduplicate by tokenId + outcome since the same ticker can have YES/NO positions
  const kalshiKeys = Array.from(new Set(
    kalshiPositions.map(p => `${p.tokenId}:${p.outcome}`)
  )).map(key => {
    const [tokenId, outcome] = key.split(':') as [string, 'YES' | 'NO'];
    return { tokenId, outcome };
  });

  // Fetch Polymarket prices
  const polyPrices = await Promise.all(
    polymarketTokenIds.map(async (tokenId) => {
      const mid = await getMidpoint(tokenId).catch(() => null);
      return { tokenId, midpoint: mid };
    })
  );

  // Fetch Kalshi prices (public API, no API key needed)
  const kalshiPrices = await Promise.all(
    kalshiKeys.map(async ({ tokenId, outcome }) => {
      const price = await getKalshiOutcomePrice(tokenId, outcome).catch(() => null);
      return { tokenId, outcome, midpoint: price };
    })
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
  for (const { tokenId, outcome, midpoint } of kalshiPrices) {
    if (midpoint === null || typeof midpoint !== 'number') continue;

    if (redis) {
      await redis.set(`price:${tokenId}:${outcome}`, midpoint, { ex: 30 }).catch(() => {});
    }

    await db
      .update(positions)
      .set({ currentPrice: midpoint.toFixed(6), updatedAt: new Date() })
      .where(eq(positions.tokenId, tokenId));
  }
  
  return polymarketTokenIds.length + kalshiKeys.length;
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
