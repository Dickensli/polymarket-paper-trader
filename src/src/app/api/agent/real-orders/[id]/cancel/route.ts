import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { realTradeOrders } from '@/lib/db/schema';

// POST /api/agent/real-orders/[id]/cancel
//
// Audit-first placeholder until official venue cancel clients are wired.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const db = getDb();
    const order = await db.query.realTradeOrders.findFirst({
      where: eq(realTradeOrders.id, id),
    });

    if (!order || order.userId !== session.user.id) {
      return NextResponse.json({ error: 'Real order not found' }, { status: 404 });
    }

    const [updated] = await db
      .update(realTradeOrders)
      .set({
        status: 'CANCEL_REJECTED',
        error: {
          code: 'CANCEL_CLIENT_NOT_IMPLEMENTED',
          message: 'Official cancel client is not wired server-side yet.',
        },
        updatedAt: new Date(),
      })
      .where(eq(realTradeOrders.id, id))
      .returning();

    return NextResponse.json(
      {
        error: 'Official cancel client is not implemented yet.',
        audit: updated,
      },
      { status: 501 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
