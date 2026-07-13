import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  officialOrderEvents,
  officialSettlements,
  officialSyncState,
  officialTradeFills,
  portfolioSnapshots,
  realTradeOrders,
  strategies,
} from '@/lib/db/schema';
import {
  getOfficialPortfolioSnapshot,
  getOfficialKalshiHistoricalFills,
  kalshiOrderQuantity,
  normalizeKalshiOrderStatus,
} from '@/lib/official-trading';
import {
  normalizeKalshiFill,
  normalizeKalshiOrderEvent,
  normalizeKalshiSettlement,
} from '@/lib/official-ledger';

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

      if (platform === 'kalshi') {
        const historicalState = await db.query.officialSyncState.findFirst({
          where: and(
            eq(officialSyncState.platform, 'kalshi'),
            eq(officialSyncState.resource, 'historical_fills'),
          ),
        });
        const historicalFills = historicalState?.lastSuccessAt
          ? []
          : await getOfficialKalshiHistoricalFills();
        const audits = await db.query.realTradeOrders.findMany();
        const auditByOrderId = new Map(audits
          .filter((audit) => audit.officialOrderId)
          .map((audit) => [audit.officialOrderId!, audit]));

        // A venue fill can arrive before the local submit route has committed
        // its audit row. Repair those initially-unattributed immutable facts
        // whenever the official order id later becomes known locally.
        for (const audit of auditByOrderId.values()) {
          await db.update(officialTradeFills).set({
            realTradeOrderId: audit.id,
            strategyId: audit.strategyId,
            userId: audit.userId,
          }).where(and(
            eq(officialTradeFills.officialOrderId, audit.officialOrderId!),
            isNull(officialTradeFills.strategyId),
          ));
          await db.update(officialOrderEvents).set({
            realTradeOrderId: audit.id,
            strategyId: audit.strategyId,
            userId: audit.userId,
          }).where(and(
            eq(officialOrderEvents.officialOrderId, audit.officialOrderId!),
            isNull(officialOrderEvents.strategyId),
          ));
        }

        for (const row of snapshot.orders) {
          if (!row || typeof row !== 'object') continue;
          const event = normalizeKalshiOrderEvent(row as Record<string, unknown>);
          const audit = auditByOrderId.get(event.officialOrderId);
          const insertEvent = db.insert(officialOrderEvents).values({
            ...event,
            realTradeOrderId: audit?.id ?? null,
            strategyId: audit?.strategyId ?? null,
            userId: audit?.userId ?? null,
            requestedQuantity: event.requestedQuantity.toFixed(6),
            filledQuantity: event.filledQuantity.toFixed(6),
            remainingQuantity: event.remainingQuantity.toFixed(6),
          });
          if (audit) {
            await insertEvent.onConflictDoUpdate({
              target: officialOrderEvents.eventKey,
              set: { realTradeOrderId: audit.id, strategyId: audit.strategyId, userId: audit.userId },
            });
          } else {
            await insertEvent.onConflictDoNothing();
          }
        }

        for (const row of [...historicalFills, ...snapshot.fills]) {
          if (!row || typeof row !== 'object') continue;
          const fill = normalizeKalshiFill(row as Record<string, unknown>);
          const audit = fill.officialOrderId ? auditByOrderId.get(fill.officialOrderId) : undefined;
          const insertFill = db.insert(officialTradeFills).values({
            ...fill,
            realTradeOrderId: audit?.id ?? null,
            strategyId: audit?.strategyId ?? null,
            userId: audit?.userId ?? null,
            quantity: fill.quantity.toFixed(6),
            price: fill.price.toFixed(6),
            fee: fill.fee.toFixed(6),
          });
          if (audit) {
            await insertFill.onConflictDoUpdate({
              target: [officialTradeFills.platform, officialTradeFills.officialFillId],
              set: { realTradeOrderId: audit.id, strategyId: audit.strategyId, userId: audit.userId },
            });
          } else {
            await insertFill.onConflictDoNothing();
          }
        }

        for (const row of snapshot.settlements ?? []) {
          if (!row || typeof row !== 'object') continue;
          const settlement = normalizeKalshiSettlement(row as Record<string, unknown>);
          await db.insert(officialSettlements).values({
            ...settlement,
            yesQuantity: settlement.yesQuantity.toFixed(6),
            noQuantity: settlement.noQuantity.toFixed(6),
            yesCost: settlement.yesCost.toFixed(6),
            noCost: settlement.noCost.toFixed(6),
            revenue: settlement.revenue.toFixed(6),
            fee: settlement.fee.toFixed(6),
          }).onConflictDoNothing();
        }

        for (const resource of ['orders', 'fills', 'settlements']) {
          await db.insert(officialSyncState).values({
            platform,
            accountScope: 'default',
            resource,
            lastSuccessAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: [officialSyncState.platform, officialSyncState.accountScope, officialSyncState.resource],
            set: { lastSuccessAt: new Date(), lastError: null, updatedAt: new Date() },
          });
        }
        if (!historicalState?.lastSuccessAt) {
          await db.insert(officialSyncState).values({
            platform, accountScope: 'default', resource: 'historical_fills',
            lastSuccessAt: new Date(), lastError: null, updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: [officialSyncState.platform, officialSyncState.accountScope, officialSyncState.resource],
            set: { lastSuccessAt: new Date(), lastError: null, updatedAt: new Date() },
          });
        }
      }

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
