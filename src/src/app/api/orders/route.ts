import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createLimitOrderSchema } from '@/lib/validations';
import {
  createLimitOrder,
  getPendingOrders,
  getAllOrders,
} from '@/lib/limit-orders';
import { TradingError } from '@/lib/trading-engine';

/**
 * GET /api/orders — list orders for the authenticated user.
 *
 * Query params:
 *  - status: filter by order status (PENDING, FILLED, CANCELLED, EXPIRED, REJECTED)
 *  - limit:  max number of orders to return (default 100)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = Math.min(
      Number(searchParams.get('limit') || '100'),
      500,
    );

    let orders;
    if (status === 'PENDING') {
      orders = await getPendingOrders(session.user.id);
    } else {
      orders = await getAllOrders(session.user.id, limit);
      // Filter by status if requested (for non-PENDING statuses)
      if (status) {
        orders = orders.filter((o) => o.status === status);
      }
    }

    return NextResponse.json({ data: orders }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}

/**
 * POST /api/orders — create a new limit order.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = createLimitOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }

    const order = await createLimitOrder(session.user.id, parsed.data);
    return NextResponse.json({ data: order }, { status: 201 });
  } catch (err) {
    if (err instanceof TradingError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
