import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { positions } from '@/lib/db/schema';
import { executeTrade, TradingError } from '@/lib/trading-engine';
import { getPolymarketUsOutcomePrice, polymarketUsTokenId } from '@/lib/polymarket-us';
import { idempotencyKeySchema } from '@/lib/validations';

const polymarketUsSellSchema = z.object({
  positionId: z.string().uuid().optional(),
  slug: z.string().min(1).max(255).optional(),
  outcome: z.enum(['YES', 'NO']).default('YES'),
  quantity: z.union([z.number().positive(), z.literal('ALL')]).default('ALL'),
  price: z.number().gt(0).lt(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const idempotencyKey = request.headers.get('x-idempotency-key');
    const idempParse = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!idempParse.success) {
      return NextResponse.json(
        { error: 'Missing or invalid X-Idempotency-Key header' },
        { status: 400 },
      );
    }

    const parsed = polymarketUsSellSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }

    const order = parsed.data;
    const db = getDb();
    const position = order.positionId
      ? await db.query.positions.findFirst({
          where: and(
            eq(positions.id, order.positionId),
            eq(positions.userId, session.user.id),
            eq(positions.isOpen, true),
          ),
        })
      : order.slug
        ? await db.query.positions.findFirst({
            where: and(
              eq(positions.userId, session.user.id),
              eq(positions.marketId, order.slug),
              eq(positions.outcome, order.outcome),
              eq(positions.isOpen, true),
            ),
          })
        : null;

    if (!position) {
      return NextResponse.json(
        { error: 'Polymarket US position not found' },
        { status: 404 },
      );
    }

    const slug = order.slug ?? position.marketId;
    const outcome = position.outcome as 'YES' | 'NO';
    const executionPrice =
      order.price ?? (await getPolymarketUsOutcomePrice(slug, outcome, 'SELL'));
    if (!executionPrice || executionPrice <= 0 || executionPrice >= 1) {
      return NextResponse.json(
        { error: 'Invalid or unavailable Polymarket US price' },
        { status: 400 },
      );
    }

    const heldShares = Number(position.shares);
    const shares =
      order.quantity === 'ALL'
        ? heldShares
        : Math.min(order.quantity, heldShares);

    const trade = await executeTrade(session.user.id, {
      marketId: slug,
      marketQuestion: position.marketQuestion || slug,
      tokenId: polymarketUsTokenId(slug, outcome),
      outcome,
      side: 'SELL',
      shares,
      price: executionPrice,
      idempotencyKey: idempParse.data,
      platform: 'polymarket_us',
    });

    return NextResponse.json({ data: trade }, { status: 201 });
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
