import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { leaderboardSnapshots, users, portfolios, paperTrades, positions, strategies, strategyPerformanceSnapshots } from '@/lib/db/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getUserPlatform, normalizePlatform, type TradingPlatform } from '@/lib/platform';
import { parseLeaderboardStrategyStatus } from '@/lib/leaderboard-filters';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Granularity = 'daily' | 'hourly';
type HistoryPoint = { date: string } & Record<string, string | number>;

function pageHistoryStrategies(
// ... omitted lines ...
  strategies: string[],
  history: HistoryPoint[],
  page: number,
  pageSize: number
) {
  const total = strategies.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pagedStrategies = strategies.slice(start, start + pageSize);
  const allowedKeys = new Set<string>(['date']);

  for (const strategy of pagedStrategies) {
    allowedKeys.add(strategy);
    allowedKeys.add(`${strategy}_pnl`);
    allowedKeys.add(`${strategy}_rank`);
    allowedKeys.add(`${strategy}_return_pct`);
    allowedKeys.add(`${strategy}_period_return_pct`);
    allowedKeys.add(`${strategy}_twr_pct`);
    allowedKeys.add(`${strategy}_mwr_pct`);
  }

  return {
    strategies: pagedStrategies,
    history: history.map((point) => Object.fromEntries(
      Object.entries(point).filter(([key]) => allowedKeys.has(key))
    ) as HistoryPoint),
    page: safePage,
    total,
    totalPages,
  };
}

/**
 * Build portfolio value history from real trade data.
 * Supports both daily and hourly granularity.
 * For each user:
 *   1. Start at initialBalance on portfolio creation date
 *   2. Replay trades period-by-period to compute cash balance changes
 *   3. Add current position values for the latest period
 */
async function buildHistoryFromTrades(
  db: ReturnType<typeof getDb>,
  granularity: Granularity,
  platform: TradingPlatform,
  targetUserIds?: string[]
) {
  // Fetch all relevant users
  const allUsers = await db.query.users.findMany();
  const filteredUsers = allUsers.filter(u => (
    getUserPlatform(u.settings) === platform &&
    (!targetUserIds || targetUserIds.includes(u.id))
  ));

  if (filteredUsers.length === 0) {
    return { strategies: [], history: [] };
  }

  const strategyNames: string[] = [];
  // Map: periodKey -> { date, [userName]: value, [userName_pnl]: pnl }
  const periodMap = new Map<string, HistoryPoint>();

  for (const user of filteredUsers) {
    const userName = user.name || 'Unknown';
    strategyNames.push(userName);

    // Get portfolio
    const portfolio = await db.query.portfolios.findFirst({
      where: eq(portfolios.userId, user.id)
    });
    if (!portfolio) continue;

    const initialBalance = Number(portfolio.initialBalance);
    const createdAt = portfolio.createdAt;

    // Get all trades sorted by date
    const trades = await db
      .select()
      .from(paperTrades)
      .where(eq(paperTrades.userId, user.id))
      .orderBy(asc(paperTrades.executedAt));

    // Get open positions for current market value
    const openPos = await db
      .select()
      .from(positions)
      .where(and(eq(positions.userId, user.id), eq(positions.isOpen, true)));

    const currentPositionsValue = openPos.reduce((sum, p) => {
      return sum + Number(p.shares) * Number(p.currentPrice);
    }, 0);

    // Build period-by-period cash balance and position cost basis from trades
    // Group trades by period key
    const tradesByPeriod = new Map<string, typeof trades>();
    for (const trade of trades) {
      const periodKey = getPeriodKey(trade.executedAt, granularity);
      if (!tradesByPeriod.has(periodKey)) {
        tradesByPeriod.set(periodKey, []);
      }
      tradesByPeriod.get(periodKey)!.push(trade);
    }

    // Generate period data points from portfolio creation to now
    const startDate = new Date(createdAt);
    const now = new Date();

    if (granularity === 'daily') {
      startDate.setUTCHours(0, 0, 0, 0);
      now.setUTCHours(0, 0, 0, 0);
    } else {
      // Hourly: truncate to hour
      startDate.setUTCMinutes(0, 0, 0);
      now.setUTCMinutes(0, 0, 0);
    }

    let cashBalance = initialBalance;
    // Map: tokenId -> { shares: number, avgPrice: number }
    const positionsMap = new Map<string, { shares: number; avgPrice: number }>();
    const stepMs = granularity === 'daily' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    const nowKey = getPeriodKey(now, granularity);

    for (let d = new Date(startDate); d <= now; d = new Date(d.getTime() + stepMs)) {
      const periodKey = getPeriodKey(d, granularity);

      // Apply trades for this period
      const periodTrades = tradesByPeriod.get(periodKey);
      if (periodTrades) {
        for (const t of periodTrades) {
          const shares = Number(t.shares);
          const price = Number(t.pricePerShare);
          const totalCost = Number(t.totalCost);

          if (t.action === 'BUY') {
            cashBalance -= totalCost;
            const current = positionsMap.get(t.tokenId) || { shares: 0, avgPrice: 0 };
            const newShares = current.shares + shares;
            const newAvgPrice = newShares > 0 ? (current.shares * current.avgPrice + totalCost) / newShares : 0;
            positionsMap.set(t.tokenId, { shares: newShares, avgPrice: newAvgPrice });
          } else {
            cashBalance += totalCost;
            const current = positionsMap.get(t.tokenId);
            if (current) {
              const newShares = Math.max(0, current.shares - shares);
              if (newShares === 0) {
                positionsMap.delete(t.tokenId);
              } else {
                positionsMap.set(t.tokenId, { shares: newShares, avgPrice: current.avgPrice });
              }
            }
          }
        }
      }

      // Calculate position value for this period
      let positionsValue = 0;
      const isCurrent = periodKey === nowKey;

      if (isCurrent) {
        positionsValue = currentPositionsValue;
      } else {
        // Value historical positions at cost basis (avgPrice * shares)
        for (const [_, pos] of positionsMap.entries()) {
          positionsValue += pos.shares * pos.avgPrice;
        }
      }

      const portfolioValue = cashBalance + positionsValue;
      const totalPnl = portfolioValue - initialBalance;

      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, { date: periodKey });
      }
      const periodObj = periodMap.get(periodKey)!;
      periodObj[userName] = Number(portfolioValue.toFixed(2));
      periodObj[`${userName}_pnl`] = Number(totalPnl.toFixed(2));
      periodObj[`${userName}_rank`] = 1;
    }
  }

  const history = Array.from(periodMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return { strategies: strategyNames, history };
}

/**
 * Get the period key for a given date and granularity.
 * Daily: "2026-06-24"
 * Hourly: "2026-06-24T14" (ISO date + hour)
 */
function getPeriodKey(date: Date, granularity: Granularity): string {
  const dateStr = date.toISOString().substring(0, 10);
  if (granularity === 'daily') {
    return dateStr;
  }
  const hour = date.getUTCHours().toString().padStart(2, '0');
  return `${dateStr}T${hour}`;
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = session.user.email;
    const userId = session.user.id;
    const isAdmin = userEmail === 'dickenslihaocheng@gmail.com';

    // Parse granularity from query params
    const { searchParams } = new URL(request.url);
    const granularityParam = searchParams.get('granularity');
    const granularity: Granularity = granularityParam === 'hourly' ? 'hourly' : 'daily';
    const requestedPlatform = searchParams.get('platform') || 'polymarket';
    const isRealTab = requestedPlatform.endsWith('_real');
    const platform = normalizePlatform(requestedPlatform.replace('_real', ''));
    const strategyStatus = parseLeaderboardStrategyStatus(searchParams.get('strategy_status'));
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '8', 10) || 8));

    const db = getDb();
    const eligibleStrategyRows = await db
      .select({
        id: strategies.id,
        userId: strategies.userId,
        strategyId: strategies.strategyId,
        userName: users.name,
        userEmail: users.email,
        color: users.color,
      })
      .from(strategies)
      .innerJoin(users, eq(users.id, strategies.userId))
      .where(and(
        eq(strategies.platform, platform),
        eq(strategies.agentMode, isRealTab ? 'real' : 'paper'),
        strategyStatus === 'all' ? undefined : eq(strategies.status, strategyStatus),
      ));
    const eligibleUserIds = Array.from(new Set(eligibleStrategyRows.map((strategy) => strategy.userId)))
      .filter((eligibleUserId) => isAdmin || eligibleUserId === userId);
    const eligibleUserIdSet = new Set(eligibleUserIds);
    const eligibleStrategies = eligibleStrategyRows.filter((strategy) => eligibleUserIdSet.has(strategy.userId));
    const eligibleStrategyIds = new Set(eligibleStrategies.map((strategy) => strategy.id));
    const strategyMeta = new Map(eligibleStrategies.map((strategy) => [strategy.id, {
      label: `${strategy.userName || strategy.userEmail} · ${strategy.strategyId}`,
      color: strategy.color,
    }]));

    // 1. Check for pre-computed snapshots (HOURLY or DAILY)
    const targetPeriod = granularity === 'hourly' ? 'HOURLY' : 'DAILY';

    // Prefer compact strategy-attributed mark-to-market checkpoints. The query is
    // rollout-safe: deployments without migration 0010 temporarily use legacy data.
    try {
      const compactSnapshots = await db.query.strategyPerformanceSnapshots.findMany({
        where: and(
          eq(strategyPerformanceSnapshots.bucket, targetPeriod),
          eq(strategyPerformanceSnapshots.platform, platform),
          eq(strategyPerformanceSnapshots.agentMode, isRealTab ? 'real' : 'paper'),
        ),
        orderBy: (snapshot, { asc }) => [asc(snapshot.bucketAt)],
      });
      const filteredCompactSnapshots = compactSnapshots.filter((snapshot) => eligibleStrategyIds.has(snapshot.strategyId));

      if (filteredCompactSnapshots.length > 0) {
        const periodMap = new Map<string, HistoryPoint>();
        for (const snapshot of filteredCompactSnapshots) {
          const meta = strategyMeta.get(snapshot.strategyId);
          if (!meta) continue;
          const periodKey = getPeriodKey(snapshot.bucketAt, granularity);
          const point = periodMap.get(periodKey) ?? { date: periodKey };
          point[meta.label] = Number(snapshot.nav);
          point[`${meta.label}_pnl`] = Number(snapshot.pnl);
          point[`${meta.label}_return_pct`] = Number(snapshot.returnPct);
          point[`${meta.label}_period_return_pct`] = Number(snapshot.periodReturnPct);
          point[`${meta.label}_twr_pct`] = Number(snapshot.twrPct);
          if (snapshot.mwrPct !== null) point[`${meta.label}_mwr_pct`] = Number(snapshot.mwrPct);
          point[`${meta.label}_rank`] = 1;
          periodMap.set(periodKey, point);
        }

        const strategyLabels = eligibleStrategies
          .filter((strategy) => filteredCompactSnapshots.some((snapshot) => snapshot.strategyId === strategy.id))
          .map((strategy) => strategyMeta.get(strategy.id)!.label);
        const historyData = Array.from(periodMap.values()).sort((a, b) => a.date.localeCompare(b.date));
        const paged = pageHistoryStrategies(strategyLabels, historyData, page, pageSize);
        const strategyColors = Object.fromEntries(eligibleStrategies.flatMap((strategy) => {
          const meta = strategyMeta.get(strategy.id)!;
          return meta.color ? [[meta.label, meta.color]] : [];
        }));
        const latestCapturedAt = filteredCompactSnapshots.reduce<Date | null>((latest, snapshot) => (
          !latest || snapshot.capturedAt > latest ? snapshot.capturedAt : latest
        ), null);
        const latestPricingAt = filteredCompactSnapshots.reduce<Date | null>((latest, snapshot) => (
          snapshot.pricingUpdatedAt && (!latest || snapshot.pricingUpdatedAt > latest) ? snapshot.pricingUpdatedAt : latest
        ), null);
        const unpricedPositionsCount = Math.max(...filteredCompactSnapshots.map((snapshot) => snapshot.unpricedPositionsCount));

        return NextResponse.json({
          success: true,
          strategies: paged.strategies,
          strategyColors,
          history: paged.history,
          granularity,
          meta: {
            platform, strategyStatus, granularity, page: paged.page, pageSize,
            totalStrategies: paged.total, totalPages: paged.totalPages,
            source: 'strategy_mark_to_market',
            returnMethod: 'TWR with aggregated external flows; MWR annualized since inception',
            externalFlowDetail: 'aggregate_only',
            latestCapturedAt: latestCapturedAt?.toISOString() ?? null,
            latestPricingAt: latestPricingAt?.toISOString() ?? null,
            unpricedPositionsCount,
            retention: granularity === 'hourly' ? '30 days' : '3 years',
          },
        });
      }
    } catch (compactError) {
      console.warn('Compact strategy performance unavailable; using legacy history:', compactError);
    }

    let snaps = await db.query.leaderboardSnapshots.findMany({
      where: isAdmin
        ? and(
            eq(leaderboardSnapshots.period, targetPeriod),
            eq(leaderboardSnapshots.platform, platform)
          )
        : and(
            eq(leaderboardSnapshots.period, targetPeriod),
            eq(leaderboardSnapshots.platform, platform),
            eq(leaderboardSnapshots.userId, userId)
          ),
      orderBy: (snap, { asc }) => [asc(snap.snapshotDate)]
    });

    // Backward compatibility fallback for daily: use legacy HISTORY snapshots if DAILY is empty
    if (snaps.length === 0 && granularity === 'daily') {
      snaps = await db.query.leaderboardSnapshots.findMany({
        where: isAdmin
          ? and(
              eq(leaderboardSnapshots.period, 'HISTORY'),
              eq(leaderboardSnapshots.platform, platform)
            )
          : and(
              eq(leaderboardSnapshots.period, 'HISTORY'),
              eq(leaderboardSnapshots.platform, platform),
              eq(leaderboardSnapshots.userId, userId)
            ),
        orderBy: (snap, { asc }) => [asc(snap.snapshotDate)]
      });
    }

    // 2. Apply the requested current strategy lifecycle and execution mode.
    snaps = snaps.filter((snapshot) => eligibleUserIdSet.has(snapshot.userId));

    // 3. If snapshots are found, map them to the timeseries layout and return immediately
    if (snaps.length > 0) {
      const periodMap = new Map<string, HistoryPoint>();

      for (const snap of snaps) {
        let periodKey: string;
        if (granularity === 'hourly') {
          const hour = snap.snapshotDate.getUTCHours().toString().padStart(2, '0');
          periodKey = `${snap.snapshotDate.toISOString().substring(0, 10)}T${hour}`;
        } else {
          periodKey = snap.snapshotDate.toISOString().substring(0, 10);
        }

        if (!periodMap.has(periodKey)) {
          periodMap.set(periodKey, { date: periodKey });
        }
        const periodObj = periodMap.get(periodKey)!;
        periodObj[snap.userName || 'unknown'] = Number(snap.portfolioValue);
        periodObj[`${snap.userName || 'unknown'}_pnl`] = Number(snap.totalPnl);
        periodObj[`${snap.userName || 'unknown'}_rank`] = snap.rank;
      }

      const historyData = Array.from(periodMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      const activeStrategies = Array.from(new Set(snaps.map(s => s.userName || 'unknown')));
      const paged = pageHistoryStrategies(activeStrategies, historyData, page, pageSize);

      // Fetch user colors for stable chart coloring
      const userRows = await db
        .select({ name: users.name, color: users.color })
        .from(users)
        .where(inArray(users.name, activeStrategies));
      const strategyColors: Record<string, string> = {};
      for (const row of userRows) {
        if (row.name && row.color) strategyColors[row.name] = row.color;
      }

      return NextResponse.json({
        success: true,
        strategies: paged.strategies,
        strategyColors,
        history: paged.history,
        granularity,
        meta: {
          platform,
          strategyStatus,
          granularity,
          page: paged.page,
          pageSize,
          totalStrategies: paged.total,
          totalPages: paged.totalPages,
          source: 'legacy_user_portfolio',
          returnMethod: 'simple return; historical marks may be estimated',
        },
      });
    }

    // 4. Fallback: No snapshots found — compute from real trade records
    const { strategies: resultStrategies, history } = await buildHistoryFromTrades(db, granularity, platform, eligibleUserIds);
    const paged = pageHistoryStrategies(resultStrategies, history, page, pageSize);

    // Fetch user colors for stable chart coloring
    const fallbackUserRows = resultStrategies.length > 0
      ? await db
          .select({ name: users.name, color: users.color })
          .from(users)
          .where(inArray(users.name, resultStrategies))
      : [];
    const strategyColors: Record<string, string> = {};
    for (const row of fallbackUserRows) {
      if (row.name && row.color) strategyColors[row.name] = row.color;
    }

    return NextResponse.json({
      success: true,
      strategies: paged.strategies,
      strategyColors,
      history: paged.history,
      granularity,
      meta: {
        platform,
        strategyStatus,
        granularity,
        page: paged.page,
        pageSize,
        totalStrategies: paged.total,
        totalPages: paged.totalPages,
        source: 'trade_replay_estimate',
        returnMethod: 'simple return; historical positions valued at cost basis',
      },
    });
  } catch (err) {
    console.error('Failed to fetch leaderboard history:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
