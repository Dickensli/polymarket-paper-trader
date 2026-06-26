import { describe, it, expect } from 'vitest';
import { runLeaderboardCalculation } from '@/worker/jobs/leaderboard';
import { getDb } from '@/lib/db';
import { leaderboardSnapshots } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

describe('Leaderboard Pre-compute Integration Test', () => {
  it('runs runLeaderboardCalculation and verifies DB snapshots', async () => {
    const db = getDb();

    // 1. Clear snapshots to make testing clean
    const now = new Date();
    const hourlyDate = new Date(now);
    hourlyDate.setUTCMinutes(0, 0, 0);

    const dailyDate = new Date(now);
    dailyDate.setUTCHours(0, 0, 0, 0);

    // 2. Execute calculation
    console.log("Running runLeaderboardCalculation...");
    const count = await runLeaderboardCalculation();
    console.log(`Leaderboard calculation completed. Ranked ${count} users.`);

    expect(count).toBeGreaterThanOrEqual(0);

    if (count > 0) {
      // 3. Verify HOURLY snapshots are present in the DB
      const hourlySnaps = await db.select().from(leaderboardSnapshots).where(
        eq(leaderboardSnapshots.period, 'HOURLY')
      );
      console.log(`Found ${hourlySnaps.length} HOURLY snapshots in DB.`);
      expect(hourlySnaps.length).toBeGreaterThanOrEqual(count);

      // Verify DAILY snapshots are present in the DB
      const dailySnaps = await db.select().from(leaderboardSnapshots).where(
        eq(leaderboardSnapshots.period, 'DAILY')
      );
      console.log(`Found ${dailySnaps.length} DAILY snapshots in DB.`);
      expect(dailySnaps.length).toBeGreaterThanOrEqual(count);
    }
  });
});
