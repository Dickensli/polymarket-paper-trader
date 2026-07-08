import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { users, portfolios, positions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getUserPlatform, normalizePlatform } from '@/lib/platform';

function roundTo(n: number, decimals: number): number {
  return Number(Math.round(Number(n + 'e' + decimals)) + 'e-' + decimals);
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const platform = normalizePlatform(searchParams.get('platform'));
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25', 10) || 25));

    // 1. Fetch all users and their portfolios
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
      .innerJoin(portfolios, eq(users.id, portfolios.userId));

    // 2. Fetch all open positions
    const openPositions = await db
      .select({
        userId: positions.userId,
        shares: positions.shares,
        currentPrice: positions.currentPrice,
      })
      .from(positions)
      .where(eq(positions.isOpen, true));

    // 3. Map positions by user
    const userPositionsMap = new Map<string, number>();
    for (const pos of openPositions) {
      const value = Number(pos.shares) * Number(pos.currentPrice);
      userPositionsMap.set(pos.userId, (userPositionsMap.get(pos.userId) || 0) + value);
    }

    // 3.5. Fetch latest official snapshots for real trading users
    const { portfolioSnapshots, strategies } = await import('@/lib/db/schema');
    const { desc, and } = await import('drizzle-orm');
    
    // Find users with real strategies
    const realStrats = await db.query.strategies.findMany({
      where: eq(strategies.agentMode, 'real')
    });
    const realUserIds = new Set(realStrats.map(s => s.userId));

    // Get latest official snapshots
    const latestSnapshots = new Map<string, any>();
    if (realUserIds.size > 0) {
      const allOfficialSnaps = await db.query.portfolioSnapshots.findMany({
        where: eq(portfolioSnapshots.source, 'official'),
        orderBy: [desc(portfolioSnapshots.capturedAt)]
      });
      for (const snap of allOfficialSnaps) {
        if (!latestSnapshots.has(snap.userId)) {
          latestSnapshots.set(snap.userId, snap);
        }
      }
    }

    // 4. Calculate PnL for each user
    const leaderboard = usersData
      .filter((u) => getUserPlatform(u.settings) === platform)
      .map((u) => {
        let totalValue = 0;
        let totalPnL = 0;
        let returnPct = 0;
        const initialBalance = Number(u.initialBalance || '10000');
        
        if (realUserIds.has(u.userId)) {
          const snap = latestSnapshots.get(u.userId);
          if (snap) {
            totalValue = Number(snap.totalValue);
            totalPnL = totalValue - initialBalance;
            returnPct = initialBalance > 0 ? (totalPnL / initialBalance) * 100 : 0;
          } else {
            totalValue = initialBalance;
            totalPnL = 0;
            returnPct = 0;
          }
        } else {
          const balance = Number(u.balance || '0');
          const positionsValue = userPositionsMap.get(u.userId) || 0;
          totalValue = balance + positionsValue;
          totalPnL = totalValue - initialBalance;
          returnPct = initialBalance > 0 ? (totalPnL / initialBalance) * 100 : 0;
        }

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
        platform,
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
