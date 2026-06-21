import cron from 'node-cron';
import { getDb } from '@/lib/db';
import { positions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getMidpoint } from '@/lib/polymarket';
import { Redis } from '@upstash/redis';

/**
 * Runs a single iteration of the price refresh job.
 * Extracted for easier testing.
 */
export async function runPriceRefresh() {
  const db = getDb();
  
  // 1. Get all active open positions
  const openPositions = await db.query.positions.findMany({
    where: eq(positions.isOpen, true)
  });

  // Extract unique token IDs
  const tokenIds = Array.from(new Set(openPositions.map(p => p.tokenId)));
  if (tokenIds.length === 0) return 0;

  let redis: Redis | null = null;
  try {
    redis = Redis.fromEnv();
  } catch {
    // If Redis is not configured (e.g. testing), we skip caching
  }
  
  // 2. Fetch prices
  const prices = await Promise.all(
    tokenIds.map(async (tokenId) => {
      const mid = await getMidpoint(tokenId).catch(() => null);
      return { tokenId, midpoint: mid };
    })
  );

  // 3. Update DB and Cache
  for (const { tokenId, midpoint } of prices) {
    if (midpoint === null || typeof midpoint !== 'number') continue;

    if (redis) {
      await redis.set(`price:${tokenId}`, midpoint, { ex: 30 }).catch(() => {});
    }

    await db
      .update(positions)
      .set({ currentPrice: midpoint.toFixed(6), updatedAt: new Date() })
      .where(eq(positions.tokenId, tokenId));
  }
  
  return tokenIds.length;
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
