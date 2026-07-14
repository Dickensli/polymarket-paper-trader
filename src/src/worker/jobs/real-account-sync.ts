import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  officialOrderEvents,
  officialCashLedgerEntries,
  officialSettlements,
  officialSettlementAllocations,
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
  buildFillCashLedgerEntries,
  buildSettlementCashLedgerEntries,
  normalizePolymarketUsFill,
  normalizePolymarketUsOrderEvent,
  normalizePolymarketUsSettlement,
} from '@/lib/official-ledger';
import { buildOfficialSettledStrategyPositions } from '@/lib/agent-official-settled';

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
      const ordersState = platform === 'kalshi' ? await db.query.officialSyncState.findFirst({
        where: and(eq(officialSyncState.platform, 'kalshi'), eq(officialSyncState.resource, 'orders')),
      }) : null;
      const fillsState = platform === 'kalshi' ? await db.query.officialSyncState.findFirst({
        where: and(eq(officialSyncState.platform, 'kalshi'), eq(officialSyncState.resource, 'fills')),
      }) : null;
      const settlementsState = platform === 'kalshi' ? await db.query.officialSyncState.findFirst({
        where: and(eq(officialSyncState.platform, 'kalshi'), eq(officialSyncState.resource, 'settlements')),
      }) : null;
      const overlapMinTs = (value: Date | string | null | undefined) => {
        if (!value) return undefined;
        const time = new Date(value).getTime();
        return Number.isFinite(time) ? Math.max(0, Math.floor((time - 60_000) / 1000)) : undefined;
      };
      const snapshot = await getOfficialPortfolioSnapshot(platform, {
        ordersMinTs: overlapMinTs(ordersState?.lastVenueTime),
        fillsMinTs: overlapMinTs(fillsState?.lastVenueTime),
        settlementsMinTs: overlapMinTs(settlementsState?.lastVenueTime),
      });
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

        // A fill can arrive before the submit route commits its audit row.
        // Repair all missing attribution in two set-based statements instead
        // of two remote database round trips per historical order.
        if (auditByOrderId.size > 0) {
          await db.execute(sql`
            update official_trade_fills as fact
            set real_trade_order_id = audit.id, strategy_id = audit.strategy_id, user_id = audit.user_id
            from real_trade_orders as audit
            where fact.platform = 'kalshi'
              and fact.official_order_id = audit.official_order_id
              and fact.strategy_id is null
          `);
          await db.execute(sql`
            update official_order_events as fact
            set real_trade_order_id = audit.id, strategy_id = audit.strategy_id, user_id = audit.user_id
            from real_trade_orders as audit
            where fact.platform = 'kalshi'
              and fact.official_order_id = audit.official_order_id
              and fact.strategy_id is null
          `);
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
          for (const entry of buildFillCashLedgerEntries({ ...fill, strategyId: audit?.strategyId, userId: audit?.userId })) {
            await db.insert(officialCashLedgerEntries).values({ ...entry, amount: entry.amount.toFixed(6) }).onConflictDoNothing();
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
          for (const entry of buildSettlementCashLedgerEntries(settlement)) {
            await db.insert(officialCashLedgerEntries).values({ ...entry, amount: entry.amount.toFixed(6) }).onConflictDoNothing();
          }
        }

        for (const resource of ['orders', 'fills', 'settlements']) {
          const venueRows = resource === 'fills' ? snapshot.fills : resource === 'settlements' ? (snapshot.settlements ?? []) : snapshot.orders;
          const venueTimes = venueRows.map((row) => row && typeof row === 'object'
            ? new Date(String((row as Record<string, unknown>)[resource === 'fills' ? 'created_time' : resource === 'settlements' ? 'settled_time' : 'last_update_time'] ?? 0))
            : new Date(0)).filter((date) => !Number.isNaN(date.getTime()) && date.getTime() > 0);
          const lastVenueTime = venueTimes.length > 0 ? new Date(Math.max(...venueTimes.map((date) => date.getTime()))) : undefined;
          await db.insert(officialSyncState).values({
            platform,
            accountScope: 'default',
            resource,
            lastSuccessAt: new Date(),
            lastVenueTime,
            lastError: null,
            updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: [officialSyncState.platform, officialSyncState.accountScope, officialSyncState.resource],
            set: { lastSuccessAt: new Date(), lastVenueTime, lastError: null, updatedAt: new Date() },
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

      if (platform === 'polymarket_us') {
        const audits = await db.query.realTradeOrders.findMany();
        const auditByOrderId = new Map(audits.filter((audit) => audit.officialOrderId).map((audit) => [audit.officialOrderId!, audit]));
        for (const raw of snapshot.orders) {
          if (!raw || typeof raw !== 'object') continue;
          try {
            const event = normalizePolymarketUsOrderEvent(raw as Record<string, unknown>); const audit = auditByOrderId.get(event.officialOrderId);
            await db.insert(officialOrderEvents).values({ ...event, realTradeOrderId: audit?.id ?? null, strategyId: audit?.strategyId ?? null, userId: audit?.userId ?? null, requestedQuantity: event.requestedQuantity.toFixed(6), filledQuantity: event.filledQuantity.toFixed(6), remainingQuantity: event.remainingQuantity.toFixed(6) }).onConflictDoUpdate({ target: officialOrderEvents.eventKey, set: { realTradeOrderId: audit?.id ?? null, strategyId: audit?.strategyId ?? null, userId: audit?.userId ?? null } });
          } catch { /* Unknown venue rows remain in the raw snapshot. */ }
        }
        for (const raw of snapshot.fills) {
          if (!raw || typeof raw !== 'object') continue;
          try {
            const fill = normalizePolymarketUsFill(raw as Record<string, unknown>); const audit = fill.officialOrderId ? auditByOrderId.get(fill.officialOrderId) : undefined;
            await db.insert(officialTradeFills).values({ ...fill, realTradeOrderId: audit?.id ?? null, strategyId: audit?.strategyId ?? null, userId: audit?.userId ?? null, quantity: fill.quantity.toFixed(6), price: fill.price.toFixed(6), fee: fill.fee.toFixed(6) }).onConflictDoUpdate({ target: [officialTradeFills.platform, officialTradeFills.officialFillId], set: { realTradeOrderId: audit?.id ?? null, strategyId: audit?.strategyId ?? null, userId: audit?.userId ?? null } });
            for (const entry of buildFillCashLedgerEntries({ ...fill, strategyId: audit?.strategyId, userId: audit?.userId })) await db.insert(officialCashLedgerEntries).values({ ...entry, amount: entry.amount.toFixed(6) }).onConflictDoNothing();
          } catch { /* Unknown venue rows remain in the raw snapshot. */ }
        }
        for (const raw of snapshot.activity) {
          if (!raw || typeof raw !== 'object') continue;
          try {
            const settlement = normalizePolymarketUsSettlement(raw as Record<string, unknown>); if (!settlement) continue;
            await db.insert(officialSettlements).values({ ...settlement, yesQuantity: settlement.yesQuantity.toFixed(6), noQuantity: settlement.noQuantity.toFixed(6), yesCost: '0.000000', noCost: '0.000000', revenue: settlement.revenue.toFixed(6), fee: settlement.fee.toFixed(6) }).onConflictDoNothing();
            for (const entry of buildSettlementCashLedgerEntries(settlement)) await db.insert(officialCashLedgerEntries).values({ ...entry, amount: entry.amount.toFixed(6) }).onConflictDoNothing();
          } catch { /* Non-settlement activity remains in the raw snapshot. */ }
        }
        for (const resource of ['orders', 'fills', 'settlements']) await db.insert(officialSyncState).values({ platform, accountScope: 'default', resource, lastSuccessAt: new Date(), lastError: null, updatedAt: new Date() }).onConflictDoUpdate({ target: [officialSyncState.platform, officialSyncState.accountScope, officialSyncState.resource], set: { lastSuccessAt: new Date(), lastError: null, updatedAt: new Date() } });
      }

      // Rebuild strategy allocations from immutable official facts for both
      // supported venues. Upserts make this safe after attribution repairs.
      const persistedFills = await db.query.officialTradeFills.findMany();
      const persistedSettlements = await db.query.officialSettlements.findMany();
      const allocations = buildOfficialSettledStrategyPositions(
        persistedSettlements,
        persistedFills,
        platformStrategies.map((strategy) => ({ id: strategy.id, userId: strategy.userId, name: strategy.strategyId, platform: strategy.platform })),
      );
      const allocationRows = allocations.map((allocation) => {
        const settlementId = allocation.id.split(':')[0];
        return {
          settlementId, strategyId: allocation.strategy_id, userId: allocation.agent_id,
          outcome: allocation.outcome as 'YES' | 'NO', quantity: allocation.shares.toFixed(6),
          costBasis: allocation.cost_basis.toFixed(6), proceeds: allocation.proceeds.toFixed(6),
          settlementFee: (allocation.settlement_fee ?? 0).toFixed(6), realizedPnl: allocation.realized_pnl.toFixed(6),
          allocationMethod: 'attributed_lots_official_amounts_v2', allocationVersion: 2, updatedAt: new Date(),
        } as typeof officialSettlementAllocations.$inferInsert;
      });
      for (let index = 0; index < allocationRows.length; index += 500) {
        await db.insert(officialSettlementAllocations).values(allocationRows.slice(index, index + 500)).onConflictDoUpdate({
          target: [officialSettlementAllocations.settlementId, officialSettlementAllocations.strategyId, officialSettlementAllocations.outcome],
          set: {
            quantity: sql`excluded.quantity`, costBasis: sql`excluded.cost_basis`, proceeds: sql`excluded.proceeds`,
            settlementFee: sql`excluded.settlement_fee`, realizedPnl: sql`excluded.realized_pnl`,
            allocationMethod: sql`excluded.allocation_method`, allocationVersion: sql`excluded.allocation_version`, updatedAt: new Date(),
          },
        });
      }

      // Existing official facts predate the cash ledger. Backfill them once;
      // deterministic entry keys keep retries idempotent if a run is interrupted.
      const cashBackfillState = await db.query.officialSyncState.findFirst({
        where: and(
          eq(officialSyncState.platform, platform),
          eq(officialSyncState.resource, 'cash_ledger_backfill'),
        ),
      });
      if (!cashBackfillState?.lastSuccessAt) {
        const cashEntries: Array<typeof officialCashLedgerEntries.$inferInsert> = [];
        for (const fill of persistedFills.filter((row) => row.platform === platform)) {
          for (const entry of buildFillCashLedgerEntries({
            ...fill,
            platform,
            quantity: Number(fill.quantity),
            price: Number(fill.price),
            fee: Number(fill.fee),
            payload: fill.payload as Record<string, unknown>,
          })) {
            cashEntries.push({ ...entry, amount: entry.amount.toFixed(6) } as typeof officialCashLedgerEntries.$inferInsert);
          }
        }
        for (const settlement of persistedSettlements.filter((row) => row.platform === platform)) {
          for (const entry of buildSettlementCashLedgerEntries({
            ...settlement,
            platform,
            revenue: Number(settlement.revenue),
            fee: Number(settlement.fee),
            payload: settlement.payload as Record<string, unknown>,
          })) {
            cashEntries.push({ ...entry, amount: entry.amount.toFixed(6) } as typeof officialCashLedgerEntries.$inferInsert);
          }
        }
        for (let index = 0; index < cashEntries.length; index += 500) {
          await db.insert(officialCashLedgerEntries).values(cashEntries.slice(index, index + 500)).onConflictDoNothing();
        }
        await db.insert(officialSyncState).values({
          platform, accountScope: 'default', resource: 'cash_ledger_backfill',
          lastSuccessAt: new Date(), lastError: null, updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: [officialSyncState.platform, officialSyncState.accountScope, officialSyncState.resource],
          set: { lastSuccessAt: new Date(), lastError: null, updatedAt: new Date() },
        });
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
          pnl: (snapshot.totalValue - Number(strategy.startingBalance || 0)).toFixed(6),
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
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({
        platform,
        message,
      });
      for (const resource of ['orders', 'fills', 'settlements']) {
        try {
          await db.insert(officialSyncState).values({ platform, accountScope: 'default', resource, lastError: message, updatedAt: new Date() }).onConflictDoUpdate({ target: [officialSyncState.platform, officialSyncState.accountScope, officialSyncState.resource], set: { lastError: message, updatedAt: new Date() } });
        } catch { /* Preserve the original sync error if health persistence also fails. */ }
      }
    }
  }

  return result;
}
