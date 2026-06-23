import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { cancelLimitOrder } from '@/lib/limit-orders';

/**
 * DELETE /api/orders/[id] — cancel a specific pending limit order.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    await cancelLimitOrder(session.user.id, id);
    return NextResponse.json(
      { data: { id, status: 'CANCELLED' } },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'Order not found' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
