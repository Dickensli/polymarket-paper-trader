import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { users, portfolios, leaderboardSnapshots } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import crypto from 'crypto';

import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getDeterministicUuid(userId: string, accountName: string): string {
  const hash = crypto.createHash('sha256').update(`${userId}:${accountName}`).digest('hex');
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '4' + hash.substring(13, 16),
    ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.substring(18, 20),
    hash.substring(20, 32)
  ].join('-');
}

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

    // 1. Check if we have history snapshots
    let historySnaps = await db.query.leaderboardSnapshots.findMany({
      where: isAdmin 
        ? eq(leaderboardSnapshots.period, 'HISTORY')
        : and(
            eq(leaderboardSnapshots.period, 'HISTORY'),
            eq(leaderboardSnapshots.userId, userId)
          ),
      orderBy: (snap, { asc }) => [asc(snap.snapshotDate)]
    });

    // 2. If history is empty globally or has less than 5 points (e.g. brand new db), generate 30 days of mock data
    const historyCountRes = await db.select({ value: sql<number>`count(*)` })
      .from(leaderboardSnapshots)
      .where(eq(leaderboardSnapshots.period, 'HISTORY'));
    const historyCount = historyCountRes[0]?.value ?? 0;

    if (historyCount < 5) {
      console.log("=== Generating Mock Leaderboard History (30 Days) ===");
      
      const existingUsers = await db.query.users.findMany();
      const strategies = existingUsers.map(user => ({
        id: user.id,
        name: user.name ?? 'Unknown Strategy',
        email: user.email
      }));

      const batchSnapshots: any[] = [];
      const now = new Date();

      await db.transaction(async (tx) => {
        for (const strat of strategies) {
          const userId = strat.id;
          const email = strat.email;

          // Ensure user exists (lookup by email first, then fallback to lookup by id)
          let dbUser = await tx.query.users.findFirst({ where: eq(users.email, email) });
          if (!dbUser) {
            dbUser = await tx.query.users.findFirst({ where: eq(users.id, userId) });
          }

          let actualUserId = userId;
          if (!dbUser) {
            await tx.insert(users).values({
              id: userId,
              email,
              name: strat.name,
              settings: {
                strategyName: 'default',
                defaultTradeSize: 100,
                slippageEnabled: false,
                slippageBps: 50,
                theme: 'system',
                notifications: true
              }
            });
          } else {
            actualUserId = dbUser.id;
          }

          // Ensure portfolio exists
          let dbPort = await tx.query.portfolios.findFirst({ where: eq(portfolios.userId, actualUserId) });
          if (!dbPort) {
            await tx.insert(portfolios).values({
              id: crypto.randomUUID(),
              userId: actualUserId,
              balance: '10000.000000',
              initialBalance: '10000.000000'
            });
            dbPort = await tx.query.portfolios.findFirst({ where: eq(portfolios.userId, actualUserId) });
          }

          // Generate 30 days of snapshots walking backward from current value
          let currentValue = dbPort ? parseFloat(dbPort.balance) : 10000;
          for (let i = 0; i <= 30; i++) {
            const date = new Date(now.getTime() - i * 24 * 3600 * 1000);
            
            const totalPnl = currentValue - 10000;
            const returnPct = (totalPnl / 10000) * 100;

            batchSnapshots.push({
              id: crypto.randomUUID(),
              userId: actualUserId,
              userName: strat.name,
              totalPnl: totalPnl.toFixed(6),
              returnPct: returnPct.toFixed(4),
              portfolioValue: currentValue.toFixed(6),
              rank: 1, // Placeholder, updated below per day
              period: 'HISTORY',
              snapshotDate: date
            });

            // Walk backward by subtracting forward step
            const change = (Math.random() - 0.35) * 80;
            currentValue -= change;
            if (currentValue < 1000) currentValue = 1000;
          }
        }

        // Rank the snapshots for each day
        const days = Array.from(new Set(batchSnapshots.map(s => s.snapshotDate.toDateString())));
        for (const dayString of days) {
          const daySnaps = batchSnapshots.filter(s => s.snapshotDate.toDateString() === dayString);
          daySnaps.sort((a, b) => Number(b.portfolioValue) - Number(a.portfolioValue));
          daySnaps.forEach((snap, idx) => {
            snap.rank = idx + 1;
          });
        }

        // Insert mock snapshots into DB
        await tx.insert(leaderboardSnapshots).values(batchSnapshots);
      });

      // Refetch history snapshots after mock generation with correct user authorization filter
      historySnaps = await db.query.leaderboardSnapshots.findMany({
        where: isAdmin 
          ? eq(leaderboardSnapshots.period, 'HISTORY')
          : and(
              eq(leaderboardSnapshots.period, 'HISTORY'),
              eq(leaderboardSnapshots.userId, userId)
            ),
        orderBy: (snap, { asc }) => [asc(snap.snapshotDate)]
      });
    }

    // 3. Format response for lightweight-charts or charting components
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
