import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  matchingReportStrategyIds,
  matchesStrategyLifecycle,
  parseStrategyLifecycleFilter,
  snapshotIsStale,
  selectCurrentPortfolioSnapshot,
} from '@/lib/agent-dashboard-filters';
import { buildSettledStrategyPositions } from '@/lib/agent-settled-positions';
import { buildOfficialOrderHistory } from '@/lib/agent-order-history';
import {
  enrichPositionRowsWithMarkets,
  enrichSettledRowsWithMarkets,
} from '@/lib/agent-market-context';
import {
  agentReports,
  portfolioSnapshots,
  paperTradeOrders,
  officialOrderEvents,
  officialTradeFills,
  positions,
  realTradeOrders,
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
    const strategyStatus = parseStrategyLifecycleFilter(request.nextUrl.searchParams.get('strategy_status'));
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

    const reportQueryNeedsStrategyScope =
      platform !== 'all' || agentMode !== 'all' || strategyStatus !== 'all' || strategyId !== 'all';
    const matchingReportStrategyIdsList = matchingReportStrategyIds(allStrategies, {
      platform,
      agentMode,
      lifecycle: strategyStatus,
      strategyId,
    });
    const reportsPromise = reportQueryNeedsStrategyScope
      ? matchingReportStrategyIdsList.length === 0
        ? Promise.resolve([] as (typeof agentReports.$inferSelect)[])
        : canViewAllAgents
          ? db.select().from(agentReports)
            .where(inArray(agentReports.strategyId, matchingReportStrategyIdsList))
            .orderBy(desc(agentReports.createdAt)).limit(200)
          : db.select().from(agentReports)
            .where(and(
              eq(agentReports.userId, session.user.id),
              inArray(agentReports.strategyId, matchingReportStrategyIdsList),
            ))
            .orderBy(desc(agentReports.createdAt)).limit(100)
      : canViewAllAgents
        ? db.select().from(agentReports).orderBy(desc(agentReports.createdAt)).limit(200)
        : db.select().from(agentReports).where(eq(agentReports.userId, session.user.id)).orderBy(desc(agentReports.createdAt)).limit(100);

    const [
      visibleUsers,
      reports,
      snapshots,
      realOrders,
      openPositions,
      closedPositions,
      paperOrders,
      officialFills,
      officialEvents,
    ] = await Promise.all([
      canViewAllAgents
        ? db.select().from(users).limit(1000)
        : db.select().from(users).where(eq(users.id, session.user.id)).limit(1),
      reportsPromise,
      canViewAllAgents
        ? db.select().from(portfolioSnapshots).orderBy(desc(portfolioSnapshots.capturedAt)).limit(240)
        : db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.userId, session.user.id)).orderBy(desc(portfolioSnapshots.capturedAt)).limit(120),
      canViewAllAgents
        ? db.select().from(realTradeOrders).orderBy(desc(realTradeOrders.createdAt)).limit(200)
        : db.select().from(realTradeOrders).where(eq(realTradeOrders.userId, session.user.id)).orderBy(desc(realTradeOrders.createdAt)).limit(100),
      canViewAllAgents
        ? db.select().from(positions).where(eq(positions.isOpen, true)).limit(2000)
        : db.select().from(positions).where(and(eq(positions.userId, session.user.id), eq(positions.isOpen, true))).limit(500),
      canViewAllAgents
        ? db.select().from(positions).where(eq(positions.isOpen, false)).orderBy(desc(positions.resolvedAt)).limit(1000)
        : db.select().from(positions).where(and(eq(positions.userId, session.user.id), eq(positions.isOpen, false))).orderBy(desc(positions.resolvedAt)).limit(500),
      canViewAllAgents
        ? db.select().from(paperTradeOrders).orderBy(desc(paperTradeOrders.createdAt)).limit(5000)
        : db.select().from(paperTradeOrders).where(eq(paperTradeOrders.userId, session.user.id)).orderBy(desc(paperTradeOrders.createdAt)).limit(2000),
      canViewAllAgents
        ? db.select().from(officialTradeFills).orderBy(desc(officialTradeFills.filledAt)).limit(5000)
        : db.select().from(officialTradeFills).where(eq(officialTradeFills.userId, session.user.id)).orderBy(desc(officialTradeFills.filledAt)).limit(2000),
      canViewAllAgents
        ? db.select().from(officialOrderEvents).orderBy(desc(officialOrderEvents.occurredAt)).limit(5000)
        : db.select().from(officialOrderEvents).where(eq(officialOrderEvents.userId, session.user.id)).orderBy(desc(officialOrderEvents.occurredAt)).limit(2000),
    ]);

    const officialOrderHistory = buildOfficialOrderHistory(officialFills, officialEvents);

    const strategyById = new Map(allStrategies.map((strategy) => [strategy.id, strategy]));
    const missingStrategyIds = new Set<string>();
    
    const checkStrategy = (id: string | null) => {
      if (id && !strategyById.has(id)) missingStrategyIds.add(id);
    };
    
    reports.forEach(r => checkStrategy(r.strategyId));
    snapshots.forEach(s => checkStrategy(s.strategyId));
    realOrders.forEach(o => checkStrategy(o.strategyId));
    
    if (missingStrategyIds.size > 0) {
      const missingStrategies = await db
        .select()
        .from(strategies)
        .where(inArray(strategies.id, Array.from(missingStrategyIds)));
      
      missingStrategies.forEach((strategy) => {
        strategyById.set(strategy.id, strategy);
        allStrategies.push(strategy);
      });
    }

    const filteredStrategies = allStrategies.filter((strategy) => {
      if (strategyId !== 'all' && strategy.id !== strategyId) return false;
      if (platform !== 'all' && strategy.platform !== platform) return false;
      if (agentMode !== 'all' && strategy.agentMode !== agentMode) return false;
      if (!matchesStrategyLifecycle(strategy.status, strategyStatus)) return false;
      return true;
    });
    
    const userById = new Map(visibleUsers.map((user) => [user.id, user]));

    const filteredReports = reports.filter((report) => {
      if (strategyId !== 'all' && report.strategyId !== strategyId) return false;
      const strategy = report.strategyId ? strategyById.get(report.strategyId) : null;
      if (platform !== 'all' && strategy?.platform !== platform) return false;
      if (agentMode !== 'all' && strategy?.agentMode !== agentMode) return false;
      if (!matchesStrategyLifecycle(strategy?.status, strategyStatus)) return false;
      return true;
    });

    const filteredSnapshots = snapshots.filter((snapshot) => {
      if (strategyId !== 'all' && snapshot.strategyId !== strategyId) return false;
      const strategy = snapshot.strategyId ? strategyById.get(snapshot.strategyId) : null;
      if (platform !== 'all' && (snapshot.platform || strategy?.platform) !== platform) return false;
      if (agentMode !== 'all' && (snapshot.agentMode || strategy?.agentMode) !== agentMode) return false;
      if (!matchesStrategyLifecycle(strategy?.status, strategyStatus)) return false;
      return true;
    });

    const filteredRealOrders = realOrders.filter((order) => {
      if (strategyId !== 'all' && order.strategyId !== strategyId) return false;
      if (platform !== 'all' && order.platform !== platform) return false;
      const strategy = order.strategyId ? strategyById.get(order.strategyId) : null;
      if (agentMode !== 'all' && strategy?.agentMode !== agentMode) return false;
      if (!matchesStrategyLifecycle(strategy?.status, strategyStatus)) return false;
      return true;
    });

    const latestSnapshotByStrategy = new Map<string, typeof filteredSnapshots[number]>();
    const snapshotsByStrategy = new Map<string, typeof filteredSnapshots>();
    for (const snapshot of filteredSnapshots) {
      if (!snapshot.strategyId || latestSnapshotByStrategy.has(snapshot.strategyId)) continue;
      latestSnapshotByStrategy.set(snapshot.strategyId, snapshot);
    }
    for (const snapshot of filteredSnapshots) {
      if (!snapshot.strategyId) continue;
      const rows = snapshotsByStrategy.get(snapshot.strategyId) ?? [];
      rows.push(snapshot);
      snapshotsByStrategy.set(snapshot.strategyId, rows);
    }

    const openOrderStatuses = new Set(['PENDING', 'SUBMITTING', 'SUBMITTED', 'OPEN', 'LIVE']);
    const openRealOrderCount = filteredRealOrders.filter((order) => openOrderStatuses.has(order.status)).length;
    const openPositionsByUser = new Map<string, typeof openPositions>();
    for (const position of openPositions) {
      const rows = openPositionsByUser.get(position.userId) ?? [];
      rows.push(position);
      openPositionsByUser.set(position.userId, rows);
    }

    const currentPortfolios = filteredStrategies.flatMap((strategy) => {
      const latestSnapshot = selectCurrentPortfolioSnapshot(
        snapshotsByStrategy.get(strategy.id) ?? [],
        strategy.agentMode,
      );
      if (!latestSnapshot) return [];
      if (strategy.agentMode !== 'paper') {
        return [{
          id: latestSnapshot.id,
          agent_id: latestSnapshot.userId,
          agent_email: userById.get(latestSnapshot.userId)?.email ?? null,
          agent_name: userById.get(latestSnapshot.userId)?.name ?? null,
          strategy_id: strategy.id,
          strategy_name: strategyName(strategy),
          platform: latestSnapshot.platform,
          agent_mode: latestSnapshot.agentMode,
          cash: numeric(latestSnapshot.cash),
          positions_value: numeric(latestSnapshot.positionsValue),
          total_value: numeric(latestSnapshot.totalValue),
          pnl: numeric(latestSnapshot.pnl),
          positions: latestSnapshot.positions,
          captured_at: latestSnapshot.capturedAt,
          is_stale: snapshotIsStale(latestSnapshot.capturedAt),
        }];
      }

      const currentPositions = (openPositionsByUser.get(strategy.userId) ?? []).map((position) => {
        const shares = numeric(position.shares);
        const avgEntryPrice = numeric(position.avgEntryPrice);
        const currentPrice = numeric(position.currentPrice);
        return {
          id: position.id,
          marketId: position.marketId,
          marketQuestion: position.marketQuestion,
          tokenId: position.tokenId,
          outcome: position.outcome,
          shares,
          avgEntryPrice,
          currentPrice,
          unrealizedPnL: shares * (currentPrice - avgEntryPrice),
        };
      });
      const positionsValue = currentPositions.reduce(
        (total, position) => total + position.shares * position.currentPrice,
        0,
      );
      const cash = numeric(latestSnapshot.cash);
      const totalValue = cash + positionsValue;
      return [{
        id: latestSnapshot.id,
        agent_id: strategy.userId,
        agent_email: userById.get(strategy.userId)?.email ?? null,
        agent_name: userById.get(strategy.userId)?.name ?? null,
        strategy_id: strategy.id,
        strategy_name: strategyName(strategy),
        platform: strategy.platform,
        agent_mode: strategy.agentMode,
        cash,
        positions_value: positionsValue,
        total_value: totalValue,
        pnl: totalValue - numeric(strategy.startingBalance),
        positions: currentPositions,
        captured_at: latestSnapshot.capturedAt,
        is_stale: snapshotIsStale(latestSnapshot.capturedAt),
      }];
    });
    const settledPositions = buildSettledStrategyPositions(
      closedPositions,
      paperOrders,
      filteredStrategies.map((strategy) => ({
        id: strategy.id,
        userId: strategy.userId,
        name: strategyName(strategy),
        platform: strategy.platform,
      })),
    );
    const enrichedCurrentPortfolios = await Promise.all(currentPortfolios.map(async (portfolio) => ({
      ...portfolio,
      positions: await enrichPositionRowsWithMarkets(
        portfolio.platform as 'kalshi' | 'polymarket' | 'polymarket_us',
        portfolio.positions,
      ),
    })));
    const enrichedSettledPositions = await enrichSettledRowsWithMarkets(settledPositions);

    return NextResponse.json({
      filters: {
        platform,
        agent_mode: agentMode,
        strategy_status: strategyStatus,
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
      current_portfolios: enrichedCurrentPortfolios,
      settled_positions: enrichedSettledPositions.map((position) => ({
        ...position,
        agent_email: userById.get(position.agent_id)?.email ?? null,
        agent_name: userById.get(position.agent_id)?.name ?? null,
      })),
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
        quantity: numeric(order.quantity) || numeric((order.request as Record<string, unknown> | null)?.count)
          || (numeric((order.request as Record<string, unknown> | null)?.amount) && numeric(order.price)
            ? numeric((order.request as Record<string, unknown> | null)?.amount) / numeric(order.price)
            : 0),
        price: numeric(order.price),
        status: order.status,
        request: order.request,
        official_response: order.officialResponse,
        error: order.error,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
        ...(order.officialOrderId ? officialOrderHistory.get(order.officialOrderId) : null),
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
