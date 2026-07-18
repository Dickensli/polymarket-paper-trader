import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  portfolioSnapshots,
  strategies,
  strategyCapitalFlows,
  strategyPerformanceSnapshots,
} from '@/lib/db/schema';
import {
  calculateFlowAdjustedPeriodReturnPct,
  calculateMoneyWeightedReturnPct,
  chainTwrPct,
  type CapitalFlow,
} from '@/lib/performance-returns';
import { positionBelongsToPlatform } from '@/lib/position-platform';

const HOURLY_RETENTION_DAYS = 30;
const DAILY_RETENTION_DAYS = 365 * 3;
const MAX_POSITION_PRICE_AGE_MS = 10 * 60 * 1000;

type Bucket = 'HOURLY' | 'DAILY';
type StrategyRow = typeof strategies.$inferSelect;
type SourcePoint = {
  strategyId: string;
  cash: number;
  positionsValue: number;
  nav: number;
  capturedAt: Date;
  pricingUpdatedAt: Date | null;
  unpricedPositionsCount: number;
};

export function countUnpricedPositions(
  rows: Array<{ currentPrice: string | number; updatedAt: Date }>,
  now: Date,
  maxAgeMs = MAX_POSITION_PRICE_AGE_MS,
) {
  const cutoff = now.getTime() - maxAgeMs;
  return rows.filter((row) => (
    !Number.isFinite(Number(row.currentPrice)) || row.updatedAt.getTime() < cutoff
  )).length;
}

export function countSnapshotUnpricedPositions(value: unknown) {
  if (!Array.isArray(value)) return 0;
  return value.filter((row) => (
    row && typeof row === 'object'
    && (row as Record<string, unknown>).pricing_status === 'unpriced'
  )).length;
}

function bucketDate(date: Date, bucket: Bucket) {
  const result = new Date(date);
  if (bucket === 'HOURLY') result.setUTCMinutes(0, 0, 0);
  else result.setUTCHours(0, 0, 0, 0);
  return result;
}

function capitalFlow(row: typeof strategyCapitalFlows.$inferSelect): CapitalFlow {
  return { amount: Number(row.amount), navBeforeFlow: Number(row.navBeforeFlow), occurredAt: row.occurredAt };
}

async function ensureInceptionBaselines(db: ReturnType<typeof getDb>, strategy: StrategyRow) {
  const startingBalance = Number(strategy.startingBalance).toFixed(6);
  const metadata = (strategy.metadata as Record<string, unknown> | null) ?? {};
  const configuredBaseline = new Date(String(metadata.performance_baseline_at ?? ''));
  const baselineAt = Number.isFinite(configuredBaseline.getTime()) ? configuredBaseline : strategy.createdAt;
  for (const bucket of ['HOURLY', 'DAILY'] as const) {
    await db.insert(strategyPerformanceSnapshots).values({
      strategyId: strategy.id, userId: strategy.userId, platform: strategy.platform, agentMode: strategy.agentMode,
      bucket, bucketAt: bucketDate(baselineAt, bucket), cash: startingBalance, positionsValue: '0.000000',
      nav: startingBalance, pnl: '0.000000', returnPct: '0.000000', periodReturnPct: '0.000000', twrPct: '0.000000',
      mwrPct: null, netExternalFlow: '0.000000', unpricedPositionsCount: 0, pricingUpdatedAt: null, capturedAt: baselineAt,
    }).onConflictDoNothing();
  }
}

async function upsertPerformancePoint(
  db: ReturnType<typeof getDb>,
  strategy: StrategyRow,
  bucket: Bucket,
  point: SourcePoint,
  flows: CapitalFlow[],
) {
  const bucketAt = bucketDate(point.capturedAt, bucket);
  const previous = await db.query.strategyPerformanceSnapshots.findFirst({
    where: and(
      eq(strategyPerformanceSnapshots.strategyId, strategy.id),
      eq(strategyPerformanceSnapshots.bucket, bucket),
      lt(strategyPerformanceSnapshots.bucketAt, bucketAt),
    ),
    orderBy: [desc(strategyPerformanceSnapshots.bucketAt)],
  });
  const metadata = (strategy.metadata as Record<string, unknown> | null) ?? {};
  const configuredBaseline = new Date(String(metadata.performance_baseline_at ?? ''));
  const baselineAt = Number.isFinite(configuredBaseline.getTime()) ? configuredBaseline : strategy.createdAt;
  const previousCapturedAt = previous?.capturedAt ?? baselineAt;
  const intervalFlows = flows.filter((flow) => flow.occurredAt > previousCapturedAt && flow.occurredAt <= point.capturedAt);
  const bucketEnd = new Date(bucketAt.getTime() + (bucket === 'HOURLY' ? 3600000 : 86400000));
  const bucketFlow = flows
    .filter((flow) => flow.occurredAt >= bucketAt && flow.occurredAt < bucketEnd)
    .reduce((sum, flow) => sum + flow.amount, 0);
  const flowsThroughPoint = flows.filter((flow) => flow.occurredAt <= point.capturedAt);
  const cumulativeFlow = flowsThroughPoint.reduce((sum, flow) => sum + flow.amount, 0);
  const startingBalance = Number(strategy.startingBalance);
  const pnl = point.nav - startingBalance - cumulativeFlow;
  const investedCapital = startingBalance + cumulativeFlow;
  const returnPct = investedCapital > 0 ? (pnl / investedCapital) * 100 : 0;
  const periodReturnPct = calculateFlowAdjustedPeriodReturnPct(
    previous ? Number(previous.nav) : startingBalance,
    point.nav,
    intervalFlows,
  );
  const twrPct = chainTwrPct(previous ? Number(previous.twrPct) : 0, periodReturnPct);
  const mwrPct = calculateMoneyWeightedReturnPct(startingBalance, baselineAt, point.nav, point.capturedAt, flowsThroughPoint);

  const values = {
    strategyId: strategy.id,
    userId: strategy.userId,
    platform: strategy.platform,
    agentMode: strategy.agentMode,
    bucket,
    bucketAt,
    cash: point.cash.toFixed(6),
    positionsValue: point.positionsValue.toFixed(6),
    nav: point.nav.toFixed(6),
    pnl: pnl.toFixed(6),
    returnPct: returnPct.toFixed(6),
    periodReturnPct: periodReturnPct.toFixed(6),
    twrPct: twrPct.toFixed(6),
    mwrPct: mwrPct?.toFixed(6) ?? null,
    netExternalFlow: bucketFlow.toFixed(6),
    unpricedPositionsCount: point.unpricedPositionsCount,
    pricingUpdatedAt: point.pricingUpdatedAt,
    capturedAt: point.capturedAt,
  };
  await db.insert(strategyPerformanceSnapshots).values(values).onConflictDoUpdate({
    target: [strategyPerformanceSnapshots.strategyId, strategyPerformanceSnapshots.bucket, strategyPerformanceSnapshots.bucketAt],
    set: values,
  });
}

/** Current compact checkpoints. Dedicated paper portfolios use refreshed local marks. */
export async function runStrategyPerformanceCalculation(now = new Date()) {
  const db = getDb();
  const activeStrategies = await db.query.strategies.findMany({ where: eq(strategies.status, 'active') });
  if (activeStrategies.length === 0) return 0;
  const strategyIds = activeStrategies.map((strategy) => strategy.id);
  const [allPortfolios, allPositions, flows, recentSnapshots] = await Promise.all([
    db.query.portfolios.findMany(),
    db.query.positions.findMany(),
    db.query.strategyCapitalFlows.findMany({ where: inArray(strategyCapitalFlows.strategyId, strategyIds) }),
    db.select({
      strategyId: portfolioSnapshots.strategyId,
      cash: portfolioSnapshots.cash,
      positionsValue: portfolioSnapshots.positionsValue,
      totalValue: portfolioSnapshots.totalValue,
      positions: portfolioSnapshots.positions,
      capturedAt: portfolioSnapshots.capturedAt,
    }).from(portfolioSnapshots)
      .where(inArray(portfolioSnapshots.strategyId, strategyIds))
      .orderBy(desc(portfolioSnapshots.capturedAt)),
  ]);
  const bindingCounts = new Map<string, number>();
  for (const strategy of activeStrategies) {
    const key = `${strategy.userId}|${strategy.platform}|${strategy.agentMode}`;
    bindingCounts.set(key, (bindingCounts.get(key) ?? 0) + 1);
  }
  const latestSnapshot = new Map<string, (typeof recentSnapshots)[number]>();
  for (const snapshot of recentSnapshots) {
    if (snapshot.strategyId && !latestSnapshot.has(snapshot.strategyId)) latestSnapshot.set(snapshot.strategyId, snapshot);
  }

  for (const strategy of activeStrategies) {
    await ensureInceptionBaselines(db, strategy);
    const dedicated = bindingCounts.get(`${strategy.userId}|${strategy.platform}|${strategy.agentMode}`) === 1;
    let point: SourcePoint | null = null;
    if (strategy.agentMode === 'paper' && dedicated) {
      const portfolio = allPortfolios.find((row) => row.userId === strategy.userId);
      if (portfolio) {
        const relevantPositions = allPositions.filter((row) => (
          row.userId === strategy.userId
          && row.isOpen
          && positionBelongsToPlatform(row, strategy.platform)
        ));
        const positionsValue = relevantPositions.reduce((sum, row) => sum + Number(row.shares) * Number(row.currentPrice), 0);
        const pricingUpdatedAt = relevantPositions.reduce<Date | null>((latest, row) => !latest || row.updatedAt > latest ? row.updatedAt : latest, null);
        point = {
          strategyId: strategy.id,
          cash: Number(portfolio.balance),
          positionsValue,
          nav: Number(portfolio.balance) + positionsValue,
          capturedAt: now,
          pricingUpdatedAt,
          unpricedPositionsCount: countUnpricedPositions(relevantPositions, now),
        };
      }
    }
    if (!point) {
      const snapshot = latestSnapshot.get(strategy.id);
      if (snapshot) point = {
        strategyId: strategy.id, cash: Number(snapshot.cash), positionsValue: Number(snapshot.positionsValue),
        nav: Number(snapshot.totalValue), capturedAt: now, pricingUpdatedAt: snapshot.capturedAt,
        unpricedPositionsCount: countSnapshotUnpricedPositions(snapshot.positions),
      };
    }
    if (!point) continue;
    const strategyFlows = flows.filter((row) => row.strategyId === strategy.id).map(capitalFlow);
    await upsertPerformancePoint(db, strategy, 'HOURLY', point, strategyFlows);
    await upsertPerformancePoint(db, strategy, 'DAILY', point, strategyFlows);
  }

  await db.delete(strategyPerformanceSnapshots).where(and(eq(strategyPerformanceSnapshots.bucket, 'HOURLY'), lt(strategyPerformanceSnapshots.bucketAt, new Date(now.getTime() - HOURLY_RETENTION_DAYS * 86400000))));
  await db.delete(strategyPerformanceSnapshots).where(and(eq(strategyPerformanceSnapshots.bucket, 'DAILY'), lt(strategyPerformanceSnapshots.bucketAt, new Date(now.getTime() - DAILY_RETENTION_DAYS * 86400000))));
  return activeStrategies.length;
}

/** One-time/repair backfill from existing immutable portfolio valuations. */
export async function backfillStrategyPerformanceFromPortfolioSnapshots(since = new Date(Date.now() - HOURLY_RETENTION_DAYS * 86400000)) {
  const db = getDb();
  const activeStrategies = await db.query.strategies.findMany({ where: eq(strategies.status, 'active') });
  if (activeStrategies.length === 0) return 0;
  const strategyIds = activeStrategies.map((strategy) => strategy.id);
  const [snapshots, flowRows] = await Promise.all([
    db.select({
      strategyId: portfolioSnapshots.strategyId, cash: portfolioSnapshots.cash,
      positionsValue: portfolioSnapshots.positionsValue, totalValue: portfolioSnapshots.totalValue,
      positions: portfolioSnapshots.positions,
      capturedAt: portfolioSnapshots.capturedAt,
    }).from(portfolioSnapshots).where(and(
      inArray(portfolioSnapshots.strategyId, strategyIds),
      gte(portfolioSnapshots.capturedAt, since),
    )).orderBy(asc(portfolioSnapshots.capturedAt)),
    db.query.strategyCapitalFlows.findMany({ where: inArray(strategyCapitalFlows.strategyId, strategyIds) }),
  ]);
  let written = 0;
  for (const strategy of activeStrategies) {
    await ensureInceptionBaselines(db, strategy);
    const source = snapshots.filter((snapshot) => snapshot.strategyId === strategy.id);
    const flows = flowRows.filter((row) => row.strategyId === strategy.id).map(capitalFlow);
    for (const bucket of ['HOURLY', 'DAILY'] as const) {
      const lastByBucket = new Map<number, (typeof source)[number]>();
      for (const snapshot of source) lastByBucket.set(bucketDate(snapshot.capturedAt, bucket).getTime(), snapshot);
      for (const snapshot of [...lastByBucket.values()].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())) {
        await upsertPerformancePoint(db, strategy, bucket, {
          strategyId: strategy.id, cash: Number(snapshot.cash), positionsValue: Number(snapshot.positionsValue),
          nav: Number(snapshot.totalValue), capturedAt: snapshot.capturedAt, pricingUpdatedAt: snapshot.capturedAt,
          unpricedPositionsCount: countSnapshotUnpricedPositions(snapshot.positions),
        }, flows);
        written += 1;
      }
    }
  }
  return written;
}
