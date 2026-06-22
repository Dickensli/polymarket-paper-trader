import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { users, portfolios, positions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

function roundTo(n: number, decimals: number): number {
  return Number(Math.round(Number(n + 'e' + decimals)) + 'e-' + decimals);
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const db = getDb();

    // 1. Fetch all users and their portfolios
    const usersData = await db
      .select({
        userId: users.id,
        name: users.name,
        image: users.image,
        balance: portfolios.balance,
        initialBalance: portfolios.initialBalance,
      })
      .from(users)
      .leftJoin(portfolios, eq(users.id, portfolios.userId));

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

    // 4. Calculate PnL for each user
    const leaderboard = usersData
      .map((u) => {
        const balance = Number(u.balance || '0');
        const initialBalance = Number(u.initialBalance || '10000');
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

    // Assign ranks
    leaderboard.forEach((user, idx) => {
      (user as any).rank = idx + 1;
    });

    return NextResponse.json({ data: leaderboard });
  } catch (err) {
    console.error('Failed to fetch leaderboard:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
