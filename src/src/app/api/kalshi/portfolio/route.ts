import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getPortfolio, resetPortfolio } from '@/lib/trading-engine';
import { getDb } from '@/lib/db';
import { strategies } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { realTradeOrders, reconciliationLogs } from '@/lib/db/schema';
import { compareSnapshots, DEFAULT_THRESHOLDS } from '../../agent/reconcile/route';
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDb();
    const strategy = await db.query.strategies.findFirst({
      where: eq(strategies.userId, session.user.id),
    });

    if (strategy && strategy.agentMode === 'real') {
      const { getOfficialPortfolioSnapshot } = await import('@/lib/official-trading');
      const platform = strategy.platform === 'polymarket_us' ? 'polymarket_us' : 'kalshi';
      const realPortfolio = await getOfficialPortfolioSnapshot(platform);
      
      const localOrders = await db.query.realTradeOrders.findMany({
        where: and(
          eq(realTradeOrders.strategyId, strategy.id),
          eq(realTradeOrders.userId, session.user.id),
        ),
      });
      const localPortfolio = await getPortfolio(session.user.id);
      
      const differences = compareSnapshots(
        {
          cash: localPortfolio.balance,
          positions_value: localPortfolio.totalValue - localPortfolio.balance,
          total_value: localPortfolio.totalValue,
          pnl: localPortfolio.totalPnL,
          positions: localPortfolio.positions,
          orders: localOrders,
          open_orders: localOrders,
        },
        realPortfolio,
        DEFAULT_THRESHOLDS
      );

      const hasWarningsOrErrors = differences.some(d => d.severity !== 'info');
      if (hasWarningsOrErrors) {
        for (const difference of differences) {
          if (difference.severity === 'info') continue;
          await db.insert(reconciliationLogs).values({
            strategyId: strategy.id,
            userId: session.user.id,
            runId: null,
            platform: strategy.platform,
            severity: difference.severity,
            differenceType: difference.type,
            officialSnapshot: realPortfolio,
            localSnapshot: {
              cash: localPortfolio.balance,
              positions_value: localPortfolio.totalValue - localPortfolio.balance,
              total_value: localPortfolio.totalValue,
              pnl: localPortfolio.totalPnL,
              positions: localPortfolio.positions,
            },
            diff: difference.diff,
            threshold: DEFAULT_THRESHOLDS,
            message: difference.message,
          });
        }
      }

      // Map to the shape expected by the frontend and MCP tools
      return NextResponse.json({
        data: {
          balance: realPortfolio.cash,
          positions: realPortfolio.positions,
          tradeHistory: realPortfolio.fills,
          totalValue: realPortfolio.totalValue,
          totalPnL: realPortfolio.pnl,
          totalPnLPercent: realPortfolio.totalValue > 0 ? (realPortfolio.pnl / realPortfolio.totalValue) * 100 : 0,
          raw: realPortfolio.raw,
        }
      });
    }

    const portfolio = await getPortfolio(session.user.id);
    return NextResponse.json({ data: portfolio });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const balanceParam = searchParams.get('balance');
    const initialBalance = balanceParam ? parseFloat(balanceParam) : undefined;

    const portfolio = await resetPortfolio(session.user.id, initialBalance);
    return NextResponse.json({ data: portfolio, message: 'Kalshi paper portfolio reset.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}

