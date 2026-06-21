import { startPriceRefreshJob } from './jobs/price-refresh';
import { startResolutionJob } from './jobs/resolution-handler';
import { startLeaderboardJob } from './jobs/leaderboard';

/**
 * Entry point for the background worker process.
 */
export function startWorker() {
  console.log('[Worker] Starting Polymarket Paper Trader Background Jobs...');

  startPriceRefreshJob();
  console.log('[Worker] Registered Price Refresh Job (Every 30s)');

  startResolutionJob();
  console.log('[Worker] Registered Resolution Check Job (Every 5m)');

  startLeaderboardJob();
  console.log('[Worker] Registered Leaderboard Calculation Job (Every 15m)');

  console.log('[Worker] All jobs registered and running.');
}

// Start immediately if executed directly
if (require.main === module) {
  startWorker();
}
