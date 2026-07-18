import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { portfolioSnapshots, strategies } from '@/lib/db/schema';
import { getOfficialPortfolioSnapshot } from '@/lib/official-trading';
import { POST as paperTradePost } from '@/app/api/agent/paper-trades/route';
import { POST as realTradePost } from '@/app/api/agent/real-trades/route';

function forwardRequest(request: NextRequest, body: Record<string, unknown>): NextRequest {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  return new NextRequest(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// POST /api/agent/trades
//
// Unified agent execution endpoint. The strategy registration is the source of
// truth for paper vs real mode; clients and MCP tools should call this endpoint
// instead of choosing a paper or real write path themselves.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (session?.error === 'STRATEGY_NOT_REGISTERED') {
      return NextResponse.json({ error: 'Strategy not registered. Call register_strategy first.' }, { status: 404 });
    }
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const strategyId = typeof body.strategy_id === 'string' ? body.strategy_id : '';
    if (!strategyId) {
      return NextResponse.json({ error: 'Missing strategy_id' }, { status: 400 });
    }

    const db = getDb();
    const strategy = await db.query.strategies.findFirst({
      where: and(
        eq(strategies.userId, session.user.id),
        eq(strategies.strategyId, strategyId),
      ),
    });

    if (!strategy) {
      return NextResponse.json(
        { error: `Strategy "${strategyId}" not registered. Call register_strategy first.` },
        { status: 404 },
      );
    }

    const forwarded = forwardRequest(request, body);
    if (strategy.agentMode === 'real') {
      if (strategy.platform === 'kalshi' || strategy.platform === 'polymarket_us') {
        const officialSnapshot = await getOfficialPortfolioSnapshot(strategy.platform).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to refresh official ${strategy.platform} portfolio before real trade: ${message}`);
        });

        await db.insert(portfolioSnapshots).values({
          strategyId: strategy.id,
          userId: session.user.id,
          runId: typeof body.run_id === 'string' ? body.run_id : null,
          platform: strategy.platform,
          agentMode: strategy.agentMode,
          source: 'official',
          cash: officialSnapshot.cash.toFixed(2),
          positionsValue: officialSnapshot.positionsValue.toFixed(2),
          totalValue: officialSnapshot.totalValue.toFixed(2),
          pnl: (officialSnapshot.totalValue - Number(strategy.startingBalance || 0)).toFixed(6),
          positions: officialSnapshot.positions,
          orders: officialSnapshot.orders,
        });
      }

      return realTradePost(forwarded);
    }

    return paperTradePost(forwarded);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
