import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { leaderboardSnapshots, users, portfolios, paperTrades, positions } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';

import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Granularity = 'daily' | 'hourly';

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
  targetUserIds?: string[]
) {
  // Fetch all relevant users
  const allUsers = await db.query.users.findMany();
  const filteredUsers = targetUserIds
    ? allUsers.filter(u => targetUserIds.includes(u.id))
    : allUsers;

  if (filteredUsers.length === 0) {
    return { strategies: [], history: [] };
  }

  const strategyNames: string[] = [];
  // Map: periodKey -> { date, [userName]: value, [userName_pnl]: pnl }
  const periodMap = new Map<string, Record<string, any>>();

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

    // Build period-by-period cash balance from trades
    // Group trades by period key
    const tradesByPeriod = new Map<string, { totalCost: number; action: string }[]>();
    for (const trade of trades) {
      const periodKey = getPeriodKey(trade.executedAt, granularity);
      if (!tradesByPeriod.has(periodKey)) {
        tradesByPeriod.set(periodKey, []);
      }
      tradesByPeriod.get(periodKey)!.push({
        totalCost: Number(trade.totalCost),
        action: trade.action
      });
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
    const stepMs = granularity === 'daily' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    const nowKey = getPeriodKey(now, granularity);

    for (let d = new Date(startDate); d <= now; d = new Date(d.getTime() + stepMs)) {
      const periodKey = getPeriodKey(d, granularity);

      // Apply trades for this period
      const periodTrades = tradesByPeriod.get(periodKey);
      if (periodTrades) {
        for (const t of periodTrades) {
          if (t.action === 'BUY') {
            cashBalance -= t.totalCost;
          } else {
            cashBalance += t.totalCost;
          }
        }
      }

      // For the current/latest period, add open position values
      const isCurrent = periodKey === nowKey;
      const portfolioValue = isCurrent
        ? cashBalance + currentPositionsValue
        : cashBalance;

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

    const db = getDb();

    // 1. Check for pre-computed snapshots (HOURLY or DAILY)
    const targetPeriod = granularity === 'hourly' ? 'HOURLY' : 'DAILY';

    let snaps = await db.query.leaderboardSnapshots.findMany({
      where: isAdmin
        ? eq(leaderboardSnapshots.period, targetPeriod)
        : and(
            eq(leaderboardSnapshots.period, targetPeriod),
            eq(leaderboardSnapshots.userId, userId)
          ),
      orderBy: (snap, { asc }) => [asc(snap.snapshotDate)]
    });

    // Backward compatibility fallback for daily: use legacy HISTORY snapshots if DAILY is empty
    if (snaps.length === 0 && granularity === 'daily') {
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
      const periodMap = new Map<string, Record<string, any>>();

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

      return NextResponse.json({
        success: true,
        strategies: activeStrategies,
        history: historyData,
        granularity,
      });
    }

    // 3. Fallback: No snapshots found — compute from real trade records
    const targetUserIds = isAdmin ? undefined : [userId];
    const { strategies, history } = await buildHistoryFromTrades(db, granularity, targetUserIds);

    return NextResponse.json({
      success: true,
      strategies,
      history,
      granularity,
    });
  } catch (err) {
    console.error('Failed to fetch leaderboard history:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

