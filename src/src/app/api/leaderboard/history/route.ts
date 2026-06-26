import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { leaderboardSnapshots, portfolios, paperTrades, positions } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getUserPlatform, normalizePlatform } from '@/lib/platform';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type HistoryRow = { date: string } & Record<string, string | number>;

/**
 * Build daily portfolio value history from real trade data.
 * For each user:
 *   1. Start at initialBalance on portfolio creation date
 *   2. Replay trades day-by-day to compute cash balance changes
 *   3. Add current position values for the latest day
 */
async function buildHistoryFromTrades(db: ReturnType<typeof getDb>, targetUserIds?: string[], platform = 'polymarket') {
  // Fetch all relevant users
  const allUsers = await db.query.users.findMany();
  const filteredUsers = targetUserIds
    ? allUsers.filter(u => targetUserIds.includes(u.id))
    : allUsers.filter(u => getUserPlatform(u.settings) === platform);

  if (filteredUsers.length === 0) {
    return { strategies: [], history: [] };
  }

  const strategyNames: string[] = [];
  // Map: dateKey -> { date, [userName]: value, [userName_pnl]: pnl }
  const dateMap = new Map<string, HistoryRow>();

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

    // Build day-by-day cash balance from trades
    // Group trades by date
    const tradesByDate = new Map<string, { totalCost: number; action: string }[]>();
    for (const trade of trades) {
      const dateKey = trade.executedAt.toISOString().substring(0, 10);
      if (!tradesByDate.has(dateKey)) {
        tradesByDate.set(dateKey, []);
      }
      tradesByDate.get(dateKey)!.push({
        totalCost: Number(trade.totalCost),
        action: trade.action
      });
    }

    // Generate daily data points from portfolio creation to today
    const startDate = new Date(createdAt);
    startDate.setUTCHours(0, 0, 0, 0);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let cashBalance = initialBalance;
    const dayMs = 24 * 60 * 60 * 1000;

    for (let d = new Date(startDate); d <= today; d = new Date(d.getTime() + dayMs)) {
      const dateKey = d.toISOString().substring(0, 10);

      // Apply trades for this day
      const dayTrades = tradesByDate.get(dateKey);
      if (dayTrades) {
        for (const t of dayTrades) {
          if (t.action === 'BUY') {
            cashBalance -= t.totalCost;
          } else {
            cashBalance += t.totalCost;
          }
        }
      }

      // For the current/latest day, add open position values
      const isToday = dateKey === today.toISOString().substring(0, 10);
      const portfolioValue = isToday
        ? cashBalance + currentPositionsValue
        : cashBalance; // Historical days: just cash (positions were bought/sold reflected in cash)

      const totalPnl = portfolioValue - initialBalance;

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { date: dateKey });
      }
      const dayObj = dateMap.get(dateKey)!;
      dayObj[userName] = Number(portfolioValue.toFixed(2));
      dayObj[`${userName}_pnl`] = Number(totalPnl.toFixed(2));
      dayObj[`${userName}_rank`] = 1;
    }
  }

  const history = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return { strategies: strategyNames, history };
}

function pageHistoryStrategies(strategies: string[], history: HistoryRow[], page: number, pageSize: number) {
  const total = strategies.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pagedStrategies = strategies.slice((page - 1) * pageSize, page * pageSize);
  const strategySet = new Set(pagedStrategies);
  const pagedHistory = history.map((point) => {
    const next: { date: string } & Record<string, string | number | undefined> = { date: point.date };
    for (const strategy of strategySet) {
      next[strategy] = point[strategy];
      next[`${strategy}_pnl`] = point[`${strategy}_pnl`];
      next[`${strategy}_rank`] = point[`${strategy}_rank`];
    }
    return next;
  });

  return { strategies: pagedStrategies, history: pagedHistory, total, totalPages };
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = session.user.email;
    const userId = session.user.id;
    const isAdmin = userEmail === 'dickenslihaocheng@gmail.com';
    const { searchParams } = new URL(request.url);
    const platform = normalizePlatform(searchParams.get('platform'));
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(20, Math.max(1, parseInt(searchParams.get('pageSize') ?? '8', 10) || 8));

    const db = getDb();

    // 1. Check for existing snapshots first
    const historySnaps = await db.query.leaderboardSnapshots.findMany({
      where: isAdmin 
        ? eq(leaderboardSnapshots.period, 'HISTORY')
        : and(
            eq(leaderboardSnapshots.period, 'HISTORY'),
            eq(leaderboardSnapshots.userId, userId)
          ),
      orderBy: (snap, { asc }) => [asc(snap.snapshotDate)]
    });

    // 2. If we have snapshots, use them
    if (platform === 'polymarket' && historySnaps.length > 0) {
      const dateMap = new Map<string, HistoryRow>();
      
      for (const snap of historySnaps) {
        const dateKey = snap.snapshotDate.toISOString().substring(0, 10);
        if (!dateMap.has(dateKey)) {
          dateMap.set(dateKey, { date: dateKey });
        }
        const dayObj = dateMap.get(dateKey)!;
        dayObj[snap.userName || 'unknown'] = Number(snap.portfolioValue);
        dayObj[`${snap.userName || 'unknown'}_pnl`] = Number(snap.totalPnl);
        dayObj[`${snap.userName || 'unknown'}_rank`] = snap.rank;
      }

      const historyData = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      const activeStrategies = Array.from(new Set(historySnaps.map(s => s.userName || 'unknown')));

      const paged = pageHistoryStrategies(activeStrategies, historyData, page, pageSize);
      return NextResponse.json({
        success: true,
        strategies: paged.strategies,
        history: paged.history,
        meta: { platform, page, pageSize, totalStrategies: paged.total, totalPages: paged.totalPages }
      });
    }

    // 3. No snapshots — compute from real trade data
    const targetUserIds = isAdmin ? undefined : [userId];
    const { strategies, history } = await buildHistoryFromTrades(db, targetUserIds, platform);
    const paged = pageHistoryStrategies(strategies, history, page, pageSize);

    return NextResponse.json({
      success: true,
      strategies: paged.strategies,
      history: paged.history,
      meta: { platform, page, pageSize, totalStrategies: paged.total, totalPages: paged.totalPages }
    });
  } catch (err) {
    console.error('Failed to fetch leaderboard history:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
