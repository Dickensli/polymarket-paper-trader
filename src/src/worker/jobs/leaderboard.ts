import cron from 'node-cron';
import { getDb } from '@/lib/db';
import { portfolios, positions, users, leaderboardSnapshots } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getUserPlatform } from '@/lib/platform';

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

    // Calculate total value including realized PnL from closed positions
    const balance = Number(port.balance);
    const initialBalance = Number(port.initialBalance);

    let positionsValue = 0;
    let closedRealizedPnl = 0;
    for (const pos of userPositions) {
      if (pos.isOpen) {
        positionsValue += Number(pos.shares) * Number(pos.currentPrice);
      } else {
        // Include realized PnL from closed/resolved positions
        closedRealizedPnl += Number(pos.realizedPnl) || 0;
      }
    }

    const portfolioValue = balance + positionsValue;
    const totalPnl = portfolioValue - initialBalance;
    const returnPct = initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0;
    const platform = getUserPlatform(user.settings);

    snapshots.push({
      userId: user.id,
      userName: user.name || user.email,
      platform,
      totalPnl,
      returnPct,
      portfolioValue,
      rank: 0, // Will calculate below per-platform
      period: 'ALL_TIME',
      snapshotDate: new Date(),
    });
  }

  // Group by platform and calculate ranks
  const platformGroups: Record<string, typeof snapshots> = {};
  for (const snap of snapshots) {
    if (!platformGroups[snap.platform]) {
      platformGroups[snap.platform] = [];
    }
    platformGroups[snap.platform].push(snap);
  }

  for (const platform of Object.keys(platformGroups)) {
    const group = platformGroups[platform]!;
    group.sort((a, b) => b.totalPnl - a.totalPnl);
    group.forEach((snap, index) => {
      snap.rank = index + 1;
    });
  }


  if (snapshots.length > 0) {
    // Truncate timestamps for clean HOURLY and DAILY intervals
    const now = new Date();

    const hourlyDate = new Date(now);
    hourlyDate.setUTCMinutes(0, 0, 0);

    const dailyDate = new Date(now);
    dailyDate.setUTCHours(0, 0, 0, 0);

    await db.transaction(async (tx) => {
      // 1. Clear previous ALL_TIME snapshots for simplicity
      await tx.delete(leaderboardSnapshots).where(eq(leaderboardSnapshots.period, 'ALL_TIME'));

      // Insert new ALL_TIME snapshots
      await tx.insert(leaderboardSnapshots).values(
        snapshots.map(s => ({
          ...s,
          period: 'ALL_TIME',
          totalPnl: s.totalPnl.toFixed(6),
          returnPct: s.returnPct.toFixed(4),
          portfolioValue: s.portfolioValue.toFixed(6)
        }))
      );

      // 2. Pre-compute/Upsert HOURLY snapshots (delete then insert for the current hour)
      for (const s of snapshots) {
        await tx
          .delete(leaderboardSnapshots)
          .where(
            and(
              eq(leaderboardSnapshots.userId, s.userId),
              eq(leaderboardSnapshots.period, 'HOURLY'),
              eq(leaderboardSnapshots.snapshotDate, hourlyDate)
            )
          );

        await tx.insert(leaderboardSnapshots).values({
          ...s,
          period: 'HOURLY',
          snapshotDate: hourlyDate,
          totalPnl: s.totalPnl.toFixed(6),
          returnPct: s.returnPct.toFixed(4),
          portfolioValue: s.portfolioValue.toFixed(6)
        });
      }

      // 3. Pre-compute/Upsert DAILY snapshots (delete then insert for the current day)
      for (const s of snapshots) {
        await tx
          .delete(leaderboardSnapshots)
          .where(
            and(
              eq(leaderboardSnapshots.userId, s.userId),
              eq(leaderboardSnapshots.period, 'DAILY'),
              eq(leaderboardSnapshots.snapshotDate, dailyDate)
            )
          );

        await tx.insert(leaderboardSnapshots).values({
          ...s,
          period: 'DAILY',
          snapshotDate: dailyDate,
          totalPnl: s.totalPnl.toFixed(6),
          returnPct: s.returnPct.toFixed(4),
          portfolioValue: s.portfolioValue.toFixed(6)
        });
      }

      // 4. Maintain legacy HISTORY snapshots (runs every 15m) for backwards compatibility if needed
      await tx.insert(leaderboardSnapshots).values(
        snapshots.map(s => ({
          ...s,
          period: 'HISTORY',
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

