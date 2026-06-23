import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkAndFillOrders } from '@/lib/limit-orders';

/**
 * POST /api/orders/check — trigger a manual order check.
 *
 * Fills eligible pending limit orders and expires stale GTD orders.
 * When called by an authenticated user, only checks THEIR orders.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await checkAndFillOrders(session.user.id);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
