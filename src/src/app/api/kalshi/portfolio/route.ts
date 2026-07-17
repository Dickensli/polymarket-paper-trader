import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getPortfolio, resetPortfolio } from '@/lib/trading-engine';
import { getDb } from '@/lib/db';
import { strategies } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { realTradeOrders, portfolios } from '@/lib/db/schema';
import { kalshiOrderQuantity, normalizeKalshiOrderStatus } from '@/lib/official-trading';
import { calculatePnLPercent } from '@/lib/portfolio-metrics';
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
      
      // Sync official state down to local DB to prevent false warnings
      // and ensure local PnL/balance accurately match official Kalshi
      if (realPortfolio) {
        // 1. Sync Cash Balance
        await db.update(portfolios)
          .set({ balance: realPortfolio.cash.toFixed(2), updatedAt: new Date() })
          .where(eq(portfolios.userId, session.user.id));
          
        // 2. Sync Order Statuses
        const validOrders = realPortfolio.orders.filter(
          (order): order is Record<string, unknown> =>
            Boolean(order && typeof order === 'object' && 'order_id' in order),
        );
        for (const order of validOrders) {
          const quantity = kalshiOrderQuantity(order);
          await db.update(realTradeOrders)
            .set({
              status: normalizeKalshiOrderStatus(order),
              quantity: quantity == null ? undefined : quantity.toFixed(6),
              officialResponse: order,
              updatedAt: new Date(),
            })
            .where(and(
              eq(realTradeOrders.userId, session.user.id),
              eq(realTradeOrders.officialOrderId, String(order.order_id)),
            ));
        }
      }

      // Map to the shape expected by the frontend and MCP tools
      const totalPnL = realPortfolio.totalValue - Number(strategy.startingBalance || 0);
      return NextResponse.json({
        data: {
          balance: realPortfolio.cash,
          positions: realPortfolio.positions,
          tradeHistory: realPortfolio.fills,
          totalValue: realPortfolio.totalValue,
          totalPnL,
          totalPnLPercent: calculatePnLPercent(totalPnL, Number(strategy.startingBalance)),
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
