import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { leaderboardSnapshots } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = session.user.email;
    const userId = session.user.id;
    const isAdmin = userEmail === 'dickenslihaocheng@gmail.com';

    const db = getDb();

    // Fetch real history snapshots only — no mock generation
    const historySnaps = await db.query.leaderboardSnapshots.findMany({
      where: isAdmin 
        ? eq(leaderboardSnapshots.period, 'HISTORY')
        : and(
            eq(leaderboardSnapshots.period, 'HISTORY'),
            eq(leaderboardSnapshots.userId, userId)
          ),
      orderBy: (snap, { asc }) => [asc(snap.snapshotDate)]
    });

    // If no snapshots exist, return empty data
    if (historySnaps.length === 0) {
      return NextResponse.json({
        success: true,
        strategies: [],
        history: []
      });
    }

    // Format response for charting components
    // Group snapshots by date (yyyy-mm-dd) and compile values
    const dateMap = new Map<string, Record<string, any>>();
    
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

    // Get unique strategy names
    const activeStrategies = Array.from(new Set(historySnaps.map(s => s.userName || 'unknown')));

    return NextResponse.json({
      success: true,
      strategies: activeStrategies,
      history: historyData
    });
  } catch (err) {
    console.error('Failed to fetch leaderboard history:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
