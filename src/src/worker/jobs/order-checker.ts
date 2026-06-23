import cron from 'node-cron';
import { checkAndFillOrders } from '@/lib/limit-orders';

/**
 * Runs a single iteration of the order-checker job.
 * Exported for easier testing.
 */
export async function runOrderCheck() {
  const result = await checkAndFillOrders();
  return result;
}

/**
 * Start the periodic order-checker cron job.
 * Runs every 60 seconds.
 */
export function startOrderCheckerJob() {
  cron.schedule('* * * * *', async () => {
    try {
      const result = await runOrderCheck();
      const { filled, expired, cancelled } = result;
      if (filled > 0 || expired > 0 || cancelled > 0) {
        console.log(
          `[Worker] Order check complete: ${filled} filled, ${expired} expired, ${cancelled} rejected`,
        );
      }
    } catch (err) {
      console.error('[Worker] Order check failed:', err);
    }
  });
}
