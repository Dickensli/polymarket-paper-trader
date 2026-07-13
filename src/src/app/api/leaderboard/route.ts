import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { users, portfolios, positions, strategies } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getUserPlatform, normalizePlatform } from '@/lib/platform';
import { parseLeaderboardStrategyStatus } from '@/lib/leaderboard-filters';

function roundTo(n: number, decimals: number): number {
  return Number(Math.round(Number(n + 'e' + decimals)) + 'e-' + decimals);
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const requestedPlatform = searchParams.get('platform') || 'polymarket';
    const isRealTab = requestedPlatform.endsWith('_real');
    const platform = normalizePlatform(requestedPlatform.replace('_real', ''));
    const strategyStatus = parseLeaderboardStrategyStatus(searchParams.get('strategy_status'));
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25', 10) || 25));

    const eligibleStrategies = await db
      .select({ userId: strategies.userId })
      .from(strategies)
      .where(and(
        eq(strategies.platform, platform),
        eq(strategies.agentMode, isRealTab ? 'real' : 'paper'),
        strategyStatus === 'all' ? undefined : eq(strategies.status, strategyStatus),
      ));
    const eligibleUserIds = Array.from(new Set(eligibleStrategies.map((strategy) => strategy.userId)));

    if (eligibleUserIds.length === 0) {
      return NextResponse.json({
        data: [],
        meta: { platform: requestedPlatform, strategyStatus, page: 1, pageSize, total: 0, totalPages: 1 },
      });
    }

    // 1. Fetch eligible users and their portfolios.
    const usersData = await db
      .select({
        userId: users.id,
        name: users.name,
        image: users.image,
        settings: users.settings,
        balance: portfolios.balance,
        initialBalance: portfolios.initialBalance,
      })
      .from(users)
      .innerJoin(portfolios, eq(users.id, portfolios.userId))
      .where(inArray(users.id, eligibleUserIds));

    // 2. Fetch all open positions
    const openPositions = await db
      .select({
        userId: positions.userId,
        shares: positions.shares,
        currentPrice: positions.currentPrice,
      })
      .from(positions)
      .where(and(eq(positions.isOpen, true), inArray(positions.userId, eligibleUserIds)));

    // 3. Map positions by user
    const userPositionsMap = new Map<string, number>();
    for (const pos of openPositions) {
      const value = Number(pos.shares) * Number(pos.currentPrice);
      userPositionsMap.set(pos.userId, (userPositionsMap.get(pos.userId) || 0) + value);
    }

    // 4. Calculate PnL for each user
    const leaderboard = usersData
      .filter((u) => getUserPlatform(u.settings) === platform)
      .map((u) => {
        const initialBalance = Number(u.initialBalance || '10000');
        const balance = Number(u.balance || '0');
        const positionsValue = userPositionsMap.get(u.userId) || 0;
        const totalValue = balance + positionsValue;
        const totalPnL = totalValue - initialBalance;
        const returnPct = initialBalance > 0 ? (totalPnL / initialBalance) * 100 : 0;

        return {
          userId: u.userId,
          name: u.name || 'Anonymous Agent',
          image: u.image,
          portfolioValue: roundTo(totalValue, 2),
          totalPnL: roundTo(totalPnL, 2),
          returnPct: roundTo(returnPct, 2),
        };
      })
      // Optional: Only show users who actually have a portfolio/activity
      .filter((u) => u.portfolioValue > 0 || u.totalPnL !== 0)
      .sort((a, b) => b.totalPnL - a.totalPnL);

    const rankedLeaderboard = leaderboard.map((user, idx) => ({ ...user, rank: idx + 1 }));

    const total = rankedLeaderboard.length;
    const start = (page - 1) * pageSize;
    const paginated = rankedLeaderboard.slice(start, start + pageSize);

    return NextResponse.json({
      data: paginated,
      meta: {
        platform: requestedPlatform,
        strategyStatus,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (err) {
    console.error('Failed to fetch leaderboard:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
