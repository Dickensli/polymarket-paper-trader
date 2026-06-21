import cron from 'node-cron';
import { getDb } from '@/lib/db';
import { portfolios, positions, users, leaderboardSnapshots } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Calculates portfolio values and creates snapshots for the leaderboard.
 */
export async function runLeaderboardCalculation() {
  const db = getDb();

  // 1. Get all portfolios
  const allPortfolios = await db.query.portfolios.findMany();

  const snapshots: any[] = [];

  for (const port of allPortfolios) {
    const user = await db.query.users.findFirst({ where: eq(users.id, port.userId) });
    if (!user) continue;

    const userPositions = await db.query.positions.findMany({
      where: eq(positions.portfolioId, port.id)
    });

    // Calculate total value
    const balance = Number(port.balance);
    const initialBalance = Number(port.initialBalance);

    let positionsValue = 0;
    for (const pos of userPositions) {
      if (pos.isOpen) {
        positionsValue += Number(pos.shares) * Number(pos.currentPrice);
      }
    }

    const portfolioValue = balance + positionsValue;
    const totalPnl = portfolioValue - initialBalance;
    const returnPct = initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0;

    snapshots.push({
      userId: user.id,
      userName: user.name || user.email,
      totalPnl,
      returnPct,
      portfolioValue,
      rank: 0, // Will calculate below
      period: 'ALL_TIME',
      snapshotDate: new Date(),
    });
  }

  // Sort by totalPnl descending to determine rank
  snapshots.sort((a, b) => b.totalPnl - a.totalPnl);
  snapshots.forEach((snap, index) => {
    snap.rank = index + 1;
  });

  if (snapshots.length > 0) {
    await db.transaction(async (tx) => {
      // Clear previous ALL_TIME snapshots for simplicity
      await tx.delete(leaderboardSnapshots).where(eq(leaderboardSnapshots.period, 'ALL_TIME'));

      // Insert new snapshots
      await tx.insert(leaderboardSnapshots).values(
        snapshots.map(s => ({
          ...s,
          totalPnl: s.totalPnl.toFixed(6),
          returnPct: s.returnPct.toFixed(4),
          portfolioValue: s.portfolioValue.toFixed(6)
        }))
      );
    });
  }

  return snapshots.length;
}

export function startLeaderboardJob() {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      const count = await runLeaderboardCalculation();
      console.log(`[Worker] Leaderboard calculation complete: ${count} users ranked`);
    } catch (err) {
      console.error('[Worker] Leaderboard calculation failed:', err);
    }
  });
}
