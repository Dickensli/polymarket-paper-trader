import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  marketCache,
  officialCashLedgerEntries,
  officialSettlementAllocations,
  officialSettlements,
  officialTradeFills,
  paperTradeOrders,
  positions,
  strategies,
  strategyPerformanceSnapshots,
} from '@/lib/db/schema';
import { calculateNoFlowMwrPct, calculatePeriodReturnPct, chainTwrPct } from '@/lib/performance-returns';
import { getKalshiMarkets, getKalshiOutcomePriceFromMarket } from '@/lib/kalshi';

const HOURLY_RETENTION_DAYS = 30;
const DAILY_RETENTION_DAYS = 365 * 3;

type Holding = { quantity: number; cost: number };

function holdingKey(userId: string, platform: string, marketId: string, outcome: string) {
  return `${userId}|${platform}|${marketId}|${outcome}`;
}

function applyFill(holdings: Map<string, Holding>, key: string, side: string | null, quantity: number, price: number) {
  const current = holdings.get(key) ?? { quantity: 0, cost: 0 };
  const direction = side === 'SELL' ? -1 : 1;
  const nextQuantity = current.quantity + direction * quantity;
  const nextCost = direction > 0 ? current.cost + quantity * price : Math.max(0, current.cost - quantity * price);
  holdings.set(key, { quantity: nextQuantity, cost: nextCost });
}

function bucketDate(now: Date, bucket: 'HOURLY' | 'DAILY') {
  const date = new Date(now);
  if (bucket === 'HOURLY') date.setUTCMinutes(0, 0, 0);
  else date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Writes compact strategy-level mark-to-market checkpoints. Existing order/fill
 * ledgers are read for attribution, but no event payload or position detail is copied.
 */
export async function runStrategyPerformanceCalculation(now = new Date()) {
  const db = getDb();
  const activeStrategies = await db.query.strategies.findMany({
    where: eq(strategies.status, 'active'),
  });

  if (activeStrategies.length === 0) return 0;

  const strategyIds = activeStrategies.map((strategy) => strategy.id);
  const [paperOrders, realFills, cashLedger, settlements, settlementFacts, currentPositions, cachedMarkets] = await Promise.all([
    db.query.paperTradeOrders.findMany({
      where: and(inArray(paperTradeOrders.strategyId, strategyIds), eq(paperTradeOrders.status, 'FILLED')),
    }),
    db.query.officialTradeFills.findMany({
      where: inArray(officialTradeFills.strategyId, strategyIds),
    }),
    db.query.officialCashLedgerEntries.findMany({
      where: and(
        inArray(officialCashLedgerEntries.strategyId, strategyIds),
        eq(officialCashLedgerEntries.accountType, 'CASH'),
      ),
    }),
    db.query.officialSettlementAllocations.findMany({
      where: inArray(officialSettlementAllocations.strategyId, strategyIds),
    }),
    db.query.officialSettlements.findMany(),
    // Closed/resolved positions carry the terminal 0/1 mark needed to value a
    // strategy's attributed lots without storing separate settlement events here.
    db.query.positions.findMany(),
    db.query.marketCache.findMany(),
  ]);
  const settlementsById = new Map(settlementFacts.map((settlement) => [settlement.id, settlement]));
  const kalshiMarkets = await getKalshiMarkets([
    ...paperOrders.filter((order) => order.platform === 'kalshi').map((order) => order.marketId),
    ...realFills.filter((fill) => fill.platform === 'kalshi').map((fill) => fill.marketId),
  ]);

  const prices = new Map<string, { price: number; updatedAt: Date }>();
  for (const position of currentPositions) {
    prices.set(
      holdingKey(position.userId, position.platform, position.marketId, position.outcome),
      { price: Number(position.currentPrice), updatedAt: position.updatedAt },
    );
  }

  const cachedPrices = new Map<string, number>();
  for (const market of cachedMarkets) {
    const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
    const outcomePrices = Array.isArray(market.outcomePrices) ? market.outcomePrices : [];
    outcomes.forEach((outcome, index) => {
      cachedPrices.set(`${market.id}|${String(outcome).toUpperCase()}`, Number(outcomePrices[index]));
      if (market.conditionId) cachedPrices.set(`${market.conditionId}|${String(outcome).toUpperCase()}`, Number(outcomePrices[index]));
    });
  }

  for (const strategy of activeStrategies) {
    const holdings = new Map<string, Holding>();
    const startingBalance = Number(strategy.startingBalance);
    let cash = startingBalance;

    if (strategy.agentMode === 'paper') {
      for (const order of paperOrders) {
        if (order.strategyId !== strategy.id) continue;
        const quantity = Number(order.quantity);
        const price = Number(order.price);
        const notional = Number(order.notional);
        cash += order.side === 'SELL' ? notional : -notional;
        applyFill(
          holdings,
          holdingKey(strategy.userId, strategy.platform, order.marketId, order.outcome),
          order.side,
          quantity,
          price,
        );
      }
    } else {
      const strategyCashEntries = cashLedger.filter((entry) => entry.strategyId === strategy.id);
      if (strategyCashEntries.length > 0) {
        cash += strategyCashEntries.reduce((sum, entry) => sum + Number(entry.amount), 0);
      }
      for (const fill of realFills) {
        if (fill.strategyId !== strategy.id || !fill.outcome) continue;
        const quantity = Number(fill.quantity);
        const price = Number(fill.price);
        if (strategyCashEntries.length === 0) {
          cash += fill.side === 'SELL' ? quantity * price - Number(fill.fee) : -(quantity * price + Number(fill.fee));
        }
        applyFill(
          holdings,
          holdingKey(strategy.userId, strategy.platform, fill.marketId, fill.outcome),
          fill.side,
          quantity,
          price,
        );
      }
      for (const allocation of settlements) {
        if (allocation.strategyId !== strategy.id) continue;
        const settlement = settlementsById.get(allocation.settlementId);
        if (!settlement) continue;
        const key = holdingKey(strategy.userId, strategy.platform, settlement.marketId, allocation.outcome);
        const current = holdings.get(key);
        if (current) holdings.set(key, { ...current, quantity: Math.max(0, current.quantity - Number(allocation.quantity)) });
      }
    }

    let positionsValue = 0;
    let unpricedPositionsCount = 0;
    let pricingUpdatedAt: Date | null = null;
    for (const [key, holding] of holdings) {
      if (holding.quantity <= 0) continue;
      const live = prices.get(key);
      const [, , marketId, outcome] = key.split('|');
      const fallback = cachedPrices.get(`${marketId}|${outcome}`);
      const kalshiMarket = strategy.platform === 'kalshi' ? kalshiMarkets.get(marketId) : undefined;
      const kalshiMark = kalshiMarket
        ? getKalshiOutcomePriceFromMarket(kalshiMarket, outcome as 'YES' | 'NO')
        : null;
      const hasIndependentMark = kalshiMark !== null || live !== undefined || (fallback !== undefined && Number.isFinite(fallback));
      if (!hasIndependentMark) unpricedPositionsCount += 1;
      const mark = kalshiMark
        ?? live?.price
        ?? (fallback !== undefined && Number.isFinite(fallback) ? fallback : holding.cost / holding.quantity);
      positionsValue += holding.quantity * mark;
      const markUpdatedAt = live?.updatedAt ?? (kalshiMark !== null ? now : null);
      if (markUpdatedAt && (!pricingUpdatedAt || markUpdatedAt > pricingUpdatedAt)) pricingUpdatedAt = markUpdatedAt;
    }

    const nav = cash + positionsValue;
    const pnl = nav - startingBalance;
    const returnPct = startingBalance > 0 ? (pnl / startingBalance) * 100 : 0;
    const mwrPct = calculateNoFlowMwrPct(startingBalance, nav, strategy.createdAt, now);

    for (const bucket of ['HOURLY', 'DAILY'] as const) {
      const bucketAt = bucketDate(now, bucket);
      const previous = await db.query.strategyPerformanceSnapshots.findFirst({
        where: and(
          eq(strategyPerformanceSnapshots.strategyId, strategy.id),
          eq(strategyPerformanceSnapshots.bucket, bucket),
          lt(strategyPerformanceSnapshots.bucketAt, bucketAt),
        ),
        orderBy: [desc(strategyPerformanceSnapshots.bucketAt)],
      });
      const periodReturnPct = calculatePeriodReturnPct(previous ? Number(previous.nav) : null, nav, 0);
      const twrPct = previous ? chainTwrPct(Number(previous.twrPct), periodReturnPct) : returnPct;

      await db.insert(strategyPerformanceSnapshots).values({
        strategyId: strategy.id,
        userId: strategy.userId,
        platform: strategy.platform,
        agentMode: strategy.agentMode,
        bucket,
        bucketAt,
        cash: cash.toFixed(6),
        positionsValue: positionsValue.toFixed(6),
        nav: nav.toFixed(6),
        pnl: pnl.toFixed(6),
        returnPct: returnPct.toFixed(6),
        periodReturnPct: periodReturnPct.toFixed(6),
        twrPct: twrPct.toFixed(6),
        mwrPct: mwrPct?.toFixed(6) ?? null,
        netExternalFlow: '0.000000',
        unpricedPositionsCount,
        pricingUpdatedAt,
        capturedAt: now,
      }).onConflictDoUpdate({
        target: [strategyPerformanceSnapshots.strategyId, strategyPerformanceSnapshots.bucket, strategyPerformanceSnapshots.bucketAt],
        set: {
          cash: cash.toFixed(6), positionsValue: positionsValue.toFixed(6), nav: nav.toFixed(6), pnl: pnl.toFixed(6),
          returnPct: returnPct.toFixed(6), periodReturnPct: periodReturnPct.toFixed(6), twrPct: twrPct.toFixed(6),
          mwrPct: mwrPct?.toFixed(6) ?? null, unpricedPositionsCount, pricingUpdatedAt, capturedAt: now,
        },
      });
    }
  }

  await db.delete(strategyPerformanceSnapshots).where(and(
    eq(strategyPerformanceSnapshots.bucket, 'HOURLY'),
    lt(strategyPerformanceSnapshots.bucketAt, new Date(now.getTime() - HOURLY_RETENTION_DAYS * 86400000)),
  ));
  await db.delete(strategyPerformanceSnapshots).where(and(
    eq(strategyPerformanceSnapshots.bucket, 'DAILY'),
    lt(strategyPerformanceSnapshots.bucketAt, new Date(now.getTime() - DAILY_RETENTION_DAYS * 86400000)),
  ));

  return activeStrategies.length;
}
