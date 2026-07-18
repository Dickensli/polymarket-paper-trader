import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { portfolioSnapshots, realTradeOrders, strategies } from '@/lib/db/schema';
import {
  cancelOfficialRealOrder,
  getOfficialPortfolioSnapshot,
} from '@/lib/official-trading';

// POST /api/agent/real-orders/[id]/cancel
//
// Audit-first official cancel flow for real orders.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sanitizeRealOrder = (o: any) => ({
      platform: o.platform,
      officialOrderId: o.officialOrderId,
      clientOrderId: o.clientOrderId,
      marketId: o.marketId,
      marketSlugOrTicker: o.marketSlugOrTicker,
      side: o.side,
      quantity: o.quantity ? Number(o.quantity) : null,
      price: o.price ? Number(o.price) : null,
      status: o.status,
      request: o.request,
      officialResponse: o.officialResponse,
      error: o.error,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    });

    const sanitizePortfolioSnapshot = (s: any) => ({
      platform: s.platform,
      agentMode: s.agentMode,
      source: s.source,
      cash: Number(s.cash),
      positionsValue: Number(s.positionsValue),
      totalValue: Number(s.totalValue),
      pnl: Number(s.pnl),
      positions: s.positions,
      orders: s.orders,
      capturedAt: s.capturedAt,
    });

    const { id } = await params;
    const db = getDb();
    const order = await db.query.realTradeOrders.findFirst({
      where: eq(realTradeOrders.id, id),
    });

    if (!order || order.userId !== session.user.id) {
      return NextResponse.json({ error: 'Real order not found' }, { status: 404 });
    }
    const strategy = await db.query.strategies.findFirst({
      where: eq(strategies.id, order.strategyId),
    });
    if (!strategy) {
      return NextResponse.json({ error: 'Strategy for real order not found' }, { status: 409 });
    }

    if (order.platform === 'polymarket') {
      return NextResponse.json(
        { error: 'Polymarket International real order cancel is not supported.' },
        { status: 400 },
      );
    }

    const officialOrderId = order.officialOrderId ?? id;
    const [submitting] = await db
      .update(realTradeOrders)
      .set({
        status: 'CANCEL_SUBMITTING',
        updatedAt: new Date(),
      })
      .where(eq(realTradeOrders.id, id))
      .returning();

    try {
      const cancelled = await cancelOfficialRealOrder(
        order.platform as 'kalshi' | 'polymarket_us',
        officialOrderId,
        order.marketSlugOrTicker ?? undefined,
      );

      const [updated] = await db
        .update(realTradeOrders)
        .set({
          status: cancelled.status,
          officialResponse: cancelled.response,
          error: {},
          updatedAt: new Date(),
        })
        .where(eq(realTradeOrders.id, id))
        .returning();

      const officialSnapshot = await getOfficialPortfolioSnapshot(
        order.platform as 'kalshi' | 'polymarket_us',
      );
      const [snapshot] = await db
        .insert(portfolioSnapshots)
        .values({
          strategyId: order.strategyId,
          userId: session.user.id,
          runId: order.runId ?? null,
          platform: order.platform,
          agentMode: 'real',
          source: 'official',
          cash: officialSnapshot.cash.toFixed(2),
          positionsValue: officialSnapshot.positionsValue.toFixed(2),
          totalValue: officialSnapshot.totalValue.toFixed(2),
          pnl: (officialSnapshot.totalValue - Number(strategy.startingBalance || 0)).toFixed(6),
          positions: officialSnapshot.positions,
          orders: officialSnapshot.orders,
        })
        .returning();

      return NextResponse.json({
        data: sanitizeRealOrder(updated),
        submitted_audit: sanitizeRealOrder(submitting),
        official_cancel: cancelled,
        official_snapshot: sanitizePortfolioSnapshot(snapshot),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const [updated] = await db
        .update(realTradeOrders)
        .set({
          status: 'CANCEL_ERROR',
          error: { code: 'OFFICIAL_CANCEL_FAILED', message },
          updatedAt: new Date(),
        })
        .where(eq(realTradeOrders.id, id))
        .returning();

      return NextResponse.json(
        {
          error: 'Official cancel failed.',
          details: message,
          audit: sanitizeRealOrder(updated),
        },
        { status: 502 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
