import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { leaderboardSnapshots, users, portfolios, paperTrades, positions } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getUserPlatform, normalizePlatform, type TradingPlatform } from '@/lib/platform';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Granularity = 'daily' | 'hourly';
type HistoryPoint = { date: string } & Record<string, string | number>;

function pageHistoryStrategies(
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
    const platform = normalizePlatform(searchParams.get('platform'));
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '8', 10) || 8));

    const db = getDb();

    // 1. Check for pre-computed snapshots (HOURLY or DAILY)
    const targetPeriod = granularity === 'hourly' ? 'HOURLY' : 'DAILY';

    let snaps = platform === 'polymarket'
      ? await db.query.leaderboardSnapshots.findMany({
          where: isAdmin
            ? eq(leaderboardSnapshots.period, targetPeriod)
            : and(
                eq(leaderboardSnapshots.period, targetPeriod),
                eq(leaderboardSnapshots.userId, userId)
              ),
          orderBy: (snap, { asc }) => [asc(snap.snapshotDate)]
        })
      : [];

    // Backward compatibility fallback for daily: use legacy HISTORY snapshots if DAILY is empty
    if (platform === 'polymarket' && snaps.length === 0 && granularity === 'daily') {
      snaps = await db.query.leaderboardSnapshots.findMany({
        where: isAdmin
          ? eq(leaderboardSnapshots.period, 'HISTORY')
          : and(
              eq(leaderboardSnapshots.period, 'HISTORY'),
              eq(leaderboardSnapshots.userId, userId)
            ),
        orderBy: (snap, { asc }) => [asc(snap.snapshotDate)]
      });
    }

    // 2. If snapshots are found, map them to the timeseries layout and return immediately
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

      return NextResponse.json({
        success: true,
        strategies: paged.strategies,
        history: paged.history,
        granularity,
        meta: {
          platform,
          granularity,
          page: paged.page,
          pageSize,
          totalStrategies: paged.total,
          totalPages: paged.totalPages,
        },
      });
    }

    // 3. Fallback: No snapshots found — compute from real trade records
    const targetUserIds = isAdmin ? undefined : [userId];
    const { strategies, history } = await buildHistoryFromTrades(db, granularity, platform, targetUserIds);
    const paged = pageHistoryStrategies(strategies, history, page, pageSize);

    return NextResponse.json({
      success: true,
      strategies: paged.strategies,
      history: paged.history,
      granularity,
      meta: {
        platform,
        granularity,
        page: paged.page,
        pageSize,
        totalStrategies: paged.total,
        totalPages: paged.totalPages,
      },
    });
  } catch (err) {
    console.error('Failed to fetch leaderboard history:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
