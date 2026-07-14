import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getPortfolio, resetPortfolio } from '@/lib/trading-engine';
import { getDb } from '@/lib/db';
import { strategies } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { realTradeOrders } from '@/lib/db/schema';
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
      const platform = strategy.platform === 'kalshi' ? 'kalshi' : 'polymarket_us';
      const realPortfolio = await getOfficialPortfolioSnapshot(platform);
      
      // Map to the shape expected by the frontend and MCP tools
      const totalPnL = realPortfolio.totalValue - Number(strategy.startingBalance || 0);
      return NextResponse.json({
        data: {
          balance: realPortfolio.cash,
          positions: realPortfolio.positions,
          tradeHistory: realPortfolio.fills,
          totalValue: realPortfolio.totalValue,
          totalPnL,
          totalPnLPercent: realPortfolio.totalValue > 0 ? (totalPnL / realPortfolio.totalValue) * 100 : 0,
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
    return NextResponse.json({ data: portfolio, message: 'Polymarket US paper portfolio reset.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
