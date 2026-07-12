import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { portfolioSnapshots, realTradeOrders, strategies } from '@/lib/db/schema';
import {
  getOfficialPortfolioSnapshot,
  kalshiOrderQuantity,
  normalizeKalshiOrderStatus,
} from '@/lib/official-trading';

type SupportedRealPlatform = 'kalshi' | 'polymarket_us';

export type RealAccountSyncResult = {
  accounts_synced: number;
  strategies_synced: number;
  errors: Array<{ platform: string; message: string }>;
};

export async function runRealAccountSync(): Promise<RealAccountSyncResult> {
  const db = getDb();
  const realStrategies = await db.query.strategies.findMany({
    where: and(eq(strategies.agentMode, 'real'), eq(strategies.status, 'active')),
  });
  const groups = new Map<SupportedRealPlatform, typeof realStrategies>();

  for (const strategy of realStrategies) {
    if (strategy.platform !== 'kalshi' && strategy.platform !== 'polymarket_us') continue;
    const rows = groups.get(strategy.platform) ?? [];
    rows.push(strategy);
    groups.set(strategy.platform, rows);
  }

  const result: RealAccountSyncResult = {
    accounts_synced: 0,
    strategies_synced: 0,
    errors: [],
  };

  for (const [platform, platformStrategies] of groups) {
    try {
      // Credentials are environment-bound per platform, so all strategies in
      // this group share one official account and one private snapshot call.
      const snapshot = await getOfficialPortfolioSnapshot(platform);
      result.accounts_synced += 1;

      for (const strategy of platformStrategies) {
        await db.insert(portfolioSnapshots).values({
          strategyId: strategy.id,
          userId: strategy.userId,
          platform: strategy.platform,
          agentMode: strategy.agentMode,
          source: 'official',
          cash: snapshot.cash.toFixed(2),
          positionsValue: snapshot.positionsValue.toFixed(2),
          totalValue: snapshot.totalValue.toFixed(2),
          pnl: snapshot.pnl.toFixed(6),
          positions: snapshot.positions,
          orders: snapshot.orders,
        });

        if (platform === 'kalshi') {
          const officialOrders = snapshot.orders.filter(
            (order): order is Record<string, unknown> =>
              Boolean(order && typeof order === 'object' && 'order_id' in order),
          );
          for (const order of officialOrders) {
            const quantity = kalshiOrderQuantity(order);
            await db.update(realTradeOrders)
              .set({
                status: normalizeKalshiOrderStatus(order),
                quantity: quantity == null ? undefined : quantity.toFixed(6),
                officialResponse: order,
                updatedAt: new Date(),
              })
              .where(and(
                eq(realTradeOrders.strategyId, strategy.id),
                eq(realTradeOrders.officialOrderId, String(order.order_id)),
              ));
          }
        }

        result.strategies_synced += 1;
      }
    } catch (error) {
      result.errors.push({
        platform,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
