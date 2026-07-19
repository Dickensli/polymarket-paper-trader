import { NextResponse } from 'next/server';
import { runPriceRefresh } from '@/worker/jobs/price-refresh';
import { runResolutionCheck } from '@/worker/jobs/resolution-handler';
import { runLeaderboardCalculation } from '@/worker/jobs/leaderboard';
import { runStrategyPerformanceCalculation } from '@/worker/jobs/strategy-performance';
import { runOrderCheck } from '@/worker/jobs/order-checker';
import { runRealAccountSync } from '@/worker/jobs/real-account-sync';
import { runPaperAccountSync } from '@/worker/jobs/paper-account-sync';

export const maxDuration = 60; // 60 seconds (Pro plan limit)

export async function GET(req: Request) {
  // Protect cron endpoint using Vercel CRON_SECRET or NEXTAUTH_SECRET as fallback (RLS secured)
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: 'Cron authentication is not configured' }, { status: 503 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
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
      const [count, strategyCount] = await Promise.all([
        runLeaderboardCalculation(),
        runStrategyPerformanceCalculation(),
      ]);
      return NextResponse.json({ success: true, message: `Leaderboard calculation complete: ${count} users ranked, ${strategyCount} strategies checkpointed` });
    } else if (task === 'order-check') {
      const result = await runOrderCheck();
      return NextResponse.json({ success: true, result });
    } else if (task === 'real-account-sync') {
      const result = await runRealAccountSync();
      return NextResponse.json({ success: result.errors.length === 0, result });
    } else if (task === 'paper-account-sync') {
      const result = await runPaperAccountSync();
      return NextResponse.json({ success: result.errors.length === 0, result });
    } else if (task === 'daily') {
      const summary: Record<string, any> = {};
      summary.pricesUpdated = await runPriceRefresh();
      summary.realAccounts = await runRealAccountSync();
      summary.paperAccounts = await runPaperAccountSync();
      summary.orderCheck = await runOrderCheck();
      summary.positionsSettled = await runResolutionCheck();
      summary.usersRanked = await runLeaderboardCalculation();
      summary.strategiesCheckpointed = await runStrategyPerformanceCalculation();

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

      // 2. Private account reconciliation for active real strategies. Calls
      // each environment-bound platform account only once per cron run.
      summary.realAccounts = await runRealAccountSync();
      
      // 2.5. Paper account snapshotting for active simulated strategies
      summary.paperAccounts = await runPaperAccountSync();
      
      // 3. Limit Order Checker (Every 5m trigger)
      summary.orderCheck = await runOrderCheck();
      
      // 4. Resolution Check (Every 5m trigger)
      summary.positionsSettled = await runResolutionCheck();
      
      // 5. Leaderboard Calculation (Every trigger, since GitHub Actions cron is irregular)
      summary.usersRanked = await runLeaderboardCalculation();
      summary.strategiesCheckpointed = await runStrategyPerformanceCalculation();
      
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
