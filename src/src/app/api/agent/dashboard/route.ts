import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  agentReports,
  portfolioSnapshots,
  realTradeOrders,
  reconciliationLogs,
  strategies,
  users,
} from '@/lib/db/schema';

type PlatformFilter = 'all' | 'polymarket' | 'kalshi' | 'polymarket_us';
type ModeFilter = 'all' | 'paper' | 'real';
const GLOBAL_AGENT_VIEWER_EMAILS = new Set(['dickenslihaocheng@gmail.com']);

function parsePlatform(value: string | null): PlatformFilter {
  if (value === 'polymarket' || value === 'kalshi' || value === 'polymarket_us') return value;
  return 'all';
}

function parseMode(value: string | null): ModeFilter {
  if (value === 'paper' || value === 'real') return value;
  return 'all';
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function strategyName(strategy: typeof strategies.$inferSelect): string {
  const legacyStrategy = strategy as typeof strategies.$inferSelect & {
    strategyName?: string;
  };
  return strategy.strategyId ?? legacyStrategy.strategyName ?? '';
}

function strategyPayload(strategy: typeof strategies.$inferSelect) {
  return {
    id: strategy.id,
    agent_id: strategy.userId,
    strategy_name: strategyName(strategy),
    agent_mode: strategy.agentMode,
    platform: strategy.platform,
    status: strategy.status,
    starting_balance: numeric(strategy.startingBalance),
    risk_config: strategy.riskConfig,
    schedule: strategy.schedule,
    metadata: strategy.metadata,
    created_at: strategy.createdAt,
    updated_at: strategy.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const platform = parsePlatform(request.nextUrl.searchParams.get('platform'));
    const agentMode = parseMode(request.nextUrl.searchParams.get('agent_mode'));
    const strategyId = request.nextUrl.searchParams.get('strategy_id') || 'all';
    const db = getDb();
    const canViewAllAgents = GLOBAL_AGENT_VIEWER_EMAILS.has(session.user.email ?? '');

    const allStrategies = canViewAllAgents
      ? await db
        .select()
        .from(strategies)
        .orderBy(desc(strategies.createdAt))
        .limit(500)
      : await db
        .select()
        .from(strategies)
        .where(eq(strategies.userId, session.user.id))
        .orderBy(desc(strategies.createdAt))
        .limit(200);

    const filteredStrategies = allStrategies.filter((strategy) => {
      if (strategyId !== 'all' && strategy.id !== strategyId) return false;
      if (platform !== 'all' && strategy.platform !== platform) return false;
      if (agentMode !== 'all' && strategy.agentMode !== agentMode) return false;
      return true;
    });
    const visibleStrategyIds = new Set(filteredStrategies.map((strategy) => strategy.id));
    const allStrategyIds = new Set(allStrategies.map((strategy) => strategy.id));
    const strategyById = new Map(allStrategies.map((strategy) => [strategy.id, strategy]));

    const [
      visibleUsers,
      reports,
      snapshots,
      realOrders,
      reconciliationWarnings,
    ] = await Promise.all([
      canViewAllAgents
        ? db.select().from(users).limit(1000)
        : db.select().from(users).where(eq(users.id, session.user.id)).limit(1),
      canViewAllAgents
        ? db.select().from(agentReports).orderBy(desc(agentReports.createdAt)).limit(200)
        : db.select().from(agentReports).where(eq(agentReports.userId, session.user.id)).orderBy(desc(agentReports.createdAt)).limit(100),
      canViewAllAgents
        ? db.select().from(portfolioSnapshots).orderBy(desc(portfolioSnapshots.capturedAt)).limit(240)
        : db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.userId, session.user.id)).orderBy(desc(portfolioSnapshots.capturedAt)).limit(120),
      canViewAllAgents
        ? db.select().from(realTradeOrders).orderBy(desc(realTradeOrders.createdAt)).limit(200)
        : db.select().from(realTradeOrders).where(eq(realTradeOrders.userId, session.user.id)).orderBy(desc(realTradeOrders.createdAt)).limit(100),
      canViewAllAgents
        ? db.select().from(reconciliationLogs).orderBy(desc(reconciliationLogs.createdAt)).limit(200)
        : db.select().from(reconciliationLogs).where(eq(reconciliationLogs.userId, session.user.id)).orderBy(desc(reconciliationLogs.createdAt)).limit(100),
    ]);
    const userById = new Map(visibleUsers.map((user) => [user.id, user]));

    const belongsToVisibleStrategy = (id: string | null) => {
      if (!id) return strategyId === 'all' && platform === 'all' && agentMode === 'all';
      return visibleStrategyIds.has(id);
    };
    const belongsToKnownStrategy = (id: string | null) => !id || allStrategyIds.has(id);

    const filteredReports = reports
      .filter((report) => belongsToKnownStrategy(report.strategyId))
      .filter((report) => belongsToVisibleStrategy(report.strategyId));
    const filteredSnapshots = snapshots
      .filter((snapshot) => belongsToKnownStrategy(snapshot.strategyId))
      .filter((snapshot) => belongsToVisibleStrategy(snapshot.strategyId));
    const filteredRealOrders = realOrders
      .filter((order) => belongsToKnownStrategy(order.strategyId))
      .filter((order) => belongsToVisibleStrategy(order.strategyId));
    const filteredWarnings = reconciliationWarnings
      .filter((log) => belongsToKnownStrategy(log.strategyId))
      .filter((log) => belongsToVisibleStrategy(log.strategyId));

    const latestSnapshotByStrategy = new Map<string, typeof filteredSnapshots[number]>();
    for (const snapshot of filteredSnapshots) {
      if (!snapshot.strategyId || latestSnapshotByStrategy.has(snapshot.strategyId)) continue;
      latestSnapshotByStrategy.set(snapshot.strategyId, snapshot);
    }

    const openOrderStatuses = new Set(['PENDING', 'SUBMITTING', 'SUBMITTED', 'OPEN', 'LIVE']);
    const activeWarningCount = filteredWarnings.filter((log) => log.severity !== 'info').length;
    const openRealOrderCount = filteredRealOrders.filter((order) => openOrderStatuses.has(order.status)).length;

    return NextResponse.json({
      filters: {
        platform,
        agent_mode: agentMode,
        strategy_id: strategyId,
      },
      access: {
        scope: canViewAllAgents ? 'global' : 'user',
      },
      summary: {
        strategies: filteredStrategies.length,
        reports: filteredReports.length,
        snapshots: filteredSnapshots.length,
        real_orders: filteredRealOrders.length,
        open_real_orders: openRealOrderCount,
        reconciliation_warnings: activeWarningCount,
      },
      strategies: filteredStrategies.map((strategy) => {
        const latestSnapshot = latestSnapshotByStrategy.get(strategy.id);
        return {
          ...strategyPayload(strategy),
          agent_email: userById.get(strategy.userId)?.email ?? null,
          agent_name: userById.get(strategy.userId)?.name ?? null,
          latest_snapshot: latestSnapshot
            ? {
                id: latestSnapshot.id,
                source: latestSnapshot.source,
                cash: numeric(latestSnapshot.cash),
                positions_value: numeric(latestSnapshot.positionsValue),
                total_value: numeric(latestSnapshot.totalValue),
                pnl: numeric(latestSnapshot.pnl),
                captured_at: latestSnapshot.capturedAt,
              }
            : null,
        };
      }),
      reports: filteredReports.map((report) => ({
        id: report.id,
        agent_id: report.userId,
        agent_email: userById.get(report.userId)?.email ?? null,
        agent_name: userById.get(report.userId)?.name ?? null,
        strategy_id: report.strategyId,
        strategy_name: report.strategyId ? strategyName(strategyById.get(report.strategyId) ?? ({} as typeof strategies.$inferSelect)) || report.strategyName : report.strategyName,
        account: report.strategyName,
        filename: report.filename,
        title: report.title,
        lessons_learned: report.lessonsLearned,
        next_steps: report.nextSteps,
        created_at: report.createdAt,
      })),
      snapshots: filteredSnapshots.map((snapshot) => ({
        id: snapshot.id,
        agent_id: snapshot.userId,
        agent_email: userById.get(snapshot.userId)?.email ?? null,
        agent_name: userById.get(snapshot.userId)?.name ?? null,
        strategy_id: snapshot.strategyId,
        strategy_name: snapshot.strategyId ? strategyName(strategyById.get(snapshot.strategyId) ?? ({} as typeof strategies.$inferSelect)) || null : null,
        run_id: snapshot.runId,
        platform: snapshot.platform,
        agent_mode: snapshot.agentMode,
        source: snapshot.source,
        cash: numeric(snapshot.cash),
        positions_value: numeric(snapshot.positionsValue),
        total_value: numeric(snapshot.totalValue),
        pnl: numeric(snapshot.pnl),
        positions: snapshot.positions,
        orders: snapshot.orders,
        captured_at: snapshot.capturedAt,
      })),
      real_orders: filteredRealOrders.map((order) => ({
        id: order.id,
        agent_id: order.userId,
        agent_email: userById.get(order.userId)?.email ?? null,
        agent_name: userById.get(order.userId)?.name ?? null,
        strategy_id: order.strategyId,
        strategy_name: strategyName(strategyById.get(order.strategyId) ?? ({} as typeof strategies.$inferSelect)) || null,
        run_id: order.runId,
        platform: order.platform,
        official_order_id: order.officialOrderId,
        client_order_id: order.clientOrderId,
        market_id: order.marketId,
        market_slug_or_ticker: order.marketSlugOrTicker,
        side: order.side,
        quantity: numeric(order.quantity),
        price: numeric(order.price),
        status: order.status,
        request: order.request,
        official_response: order.officialResponse,
        error: order.error,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
      })),
      reconciliation_logs: filteredWarnings.map((log) => ({
        id: log.id,
        agent_id: log.userId,
        agent_email: userById.get(log.userId)?.email ?? null,
        agent_name: userById.get(log.userId)?.name ?? null,
        strategy_id: log.strategyId,
        strategy_name: strategyName(strategyById.get(log.strategyId) ?? ({} as typeof strategies.$inferSelect)) || null,
        run_id: log.runId,
        platform: log.platform,
        severity: log.severity,
        difference_type: log.differenceType,
        diff: log.diff,
        threshold: log.threshold,
        message: log.message,
        created_at: log.createdAt,
      })),
      filter_options: {
        strategies: allStrategies.map(strategyPayload),
        platforms: ['all', 'polymarket', 'kalshi', 'polymarket_us'],
        agent_modes: ['all', 'paper', 'real'],
      },
    });
  } catch (err) {
    console.error('[API Dashboard Error]:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
