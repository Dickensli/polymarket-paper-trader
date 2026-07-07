import { NextResponse } from 'next/server';
import { runPriceRefresh } from '@/worker/jobs/price-refresh';
import { runResolutionCheck } from '@/worker/jobs/resolution-handler';
import { runLeaderboardCalculation } from '@/worker/jobs/leaderboard';
import { runOrderCheck } from '@/worker/jobs/order-checker';

export async function GET(req: Request) {
  // Protect cron endpoint using Vercel CRON_SECRET or NEXTAUTH_SECRET as fallback (RLS secured)
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const task = searchParams.get('task');

  try {
    if (task === 'price-refresh') {
      const count = await runPriceRefresh();
      return NextResponse.json({ success: true, message: `Price refresh complete: ${count} tokens updated` });
    } else if (task === 'resolution-check') {
      const count = await runResolutionCheck();
      return NextResponse.json({ success: true, message: `Resolution check complete: ${count} positions settled` });
    } else if (task === 'leaderboard') {
      const count = await runLeaderboardCalculation();
      return NextResponse.json({ success: true, message: `Leaderboard calculation complete: ${count} users ranked` });
    } else if (task === 'order-check') {
      const result = await runOrderCheck();
      return NextResponse.json({ success: true, result });
    } else if (task === 'daily') {
      const summary: Record<string, any> = {};
      summary.pricesUpdated = await runPriceRefresh();
      summary.orderCheck = await runOrderCheck();
      summary.positionsSettled = await runResolutionCheck();
      summary.usersRanked = await runLeaderboardCalculation();

      // Run daily active markets sync
      try {
        const url = new URL(req.url);
        const syncUrl = `${url.origin}/api/sync`;
        const syncRes = await fetch(syncUrl).catch(() => null);
        summary.syncStatus = syncRes ? await syncRes.json().catch(() => 'JSON parse error') : 'Fetch failed';
      } catch (e: any) {
        summary.syncStatus = `Error: ${e.message}`;
      }

      return NextResponse.json({ success: true, message: 'Daily tasks complete', summary });
    } else if (task === 'all' || !task) {
      // Robust Bucket-based Scheduler (designed for 5-minute execution frequency from GitHub Actions)
      const currentMinute = new Date().getMinutes();
      const bucket5m = Math.floor(currentMinute / 5); // 12 buckets per hour (0-11)
      const summary: Record<string, any> = {};
      
      // 1. Price Refresh (Every 5m trigger)
      summary.pricesUpdated = await runPriceRefresh();
      
      // 2. Limit Order Checker (Every 5m trigger)
      summary.orderCheck = await runOrderCheck();
      
      // 3. Resolution Check (Every 5m trigger)
      summary.positionsSettled = await runResolutionCheck();
      
      // 4. Leaderboard Calculation (Every trigger, since GitHub Actions cron is irregular)
      summary.usersRanked = await runLeaderboardCalculation();
      
      return NextResponse.json({
        success: true,
        currentMinute,
        bucket5m,
        summary
      });
    }

    return NextResponse.json({ error: `Invalid task parameter: ${task}` }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Cron Route Error] Task: ${task} -`, err);
    return NextResponse.json({ error: 'Internal Server Error', details: msg }, { status: 500 });
  }
}
