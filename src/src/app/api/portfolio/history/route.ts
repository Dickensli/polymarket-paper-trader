import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTradeHistory } from '@/lib/trading-engine';

/**
 * Fetch trade history.
 *
 * Query params:
 *  - `limit` (number, default 50, max 200)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const { searchParams } = request.nextUrl;
    const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50), 200);

    const trades = await getTradeHistory(userId, limit);

    return NextResponse.json({
      data: trades,
      meta: { count: trades.length, limit },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
