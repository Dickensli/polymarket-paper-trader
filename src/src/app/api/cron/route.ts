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
    } else if (task === 'force-all') {
      const summary: Record<string, any> = {};
      summary.pricesUpdated = await runPriceRefresh();
      summary.orderCheck = await runOrderCheck();
      summary.positionsSettled = await runResolutionCheck();
      summary.usersRanked = await runLeaderboardCalculation();
      return NextResponse.json({ success: true, message: 'All tasks completed successfully', summary });
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
      // Intelligent Cron Scheduler (designed for 1-minute execution frequency)
      const currentMinute = new Date().getMinutes();
      const summary: Record<string, any> = {};
      
      // 1. Price Refresh (Every 1m)
      summary.pricesUpdated = await runPriceRefresh();
      
      // 2. Limit Order Checker (Every 1m)
      summary.orderCheck = await runOrderCheck();
      
      // 3. Resolution Check (Every 5m)
      if (currentMinute % 5 === 0) {
        summary.positionsSettled = await runResolutionCheck();
      }
      
      // 4. Leaderboard Calculation (Every 15m)
      if (currentMinute % 15 === 0) {
        summary.usersRanked = await runLeaderboardCalculation();
      }

      // 5. Active Markets & Events Metadata Sync (Every 10m) - DISABLED to prevent excessive Supabase egress traffic
      /*
      if (currentMinute % 10 === 0) {
        try {
          const url = new URL(req.url);
          const syncUrl = `${url.origin}/api/sync`;
          const syncRes = await fetch(syncUrl).catch(() => null);
          summary.syncStatus = syncRes ? await syncRes.json().catch(() => 'JSON parse error') : 'Fetch failed';
        } catch (e: any) {
          summary.syncStatus = `Error: ${e.message}`;
        }
      }
      */
      
      return NextResponse.json({
        success: true,
        currentMinute,
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
