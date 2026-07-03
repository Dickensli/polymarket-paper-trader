import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { executeTrade, TradingError } from '@/lib/trading-engine';
import {
  getPolymarketUsMarket,
  getPolymarketUsOutcomePrice,
  polymarketUsTokenId,
} from '@/lib/polymarket-us';
import { idempotencyKeySchema } from '@/lib/validations';

const polymarketUsBuySchema = z.object({
  slug: z.string().min(1).max(255),
  outcome: z.enum(['YES', 'NO']).default('YES'),
  amount: z.number().positive().max(100000).optional(),
  shares: z.number().positive().optional(),
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

    const parsed = polymarketUsBuySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }

    const order = parsed.data;
    if (!order.amount && !order.shares) {
      return NextResponse.json(
        { error: 'Provide either amount or shares.' },
        { status: 400 },
      );
    }

    const market = await getPolymarketUsMarket(order.slug);
    if (!market) {
      return NextResponse.json(
        { error: 'Polymarket US market not found' },
        { status: 400 },
      );
    }

    const executionPrice =
      order.price ??
      (await getPolymarketUsOutcomePrice(order.slug, order.outcome, 'BUY'));
    if (!executionPrice || executionPrice <= 0 || executionPrice >= 1) {
      return NextResponse.json(
        { error: 'Invalid or unavailable Polymarket US price' },
        { status: 400 },
      );
    }

    const shares = order.shares ?? order.amount! / executionPrice;

    const trade = await executeTrade(session.user.id, {
      marketId: order.slug,
      marketQuestion: String(
        (market as unknown as Record<string, unknown>).question || market.title || market.description || market.slug || order.slug,
      ),
      tokenId: polymarketUsTokenId(order.slug, order.outcome),
      outcome: order.outcome,
      side: 'BUY',
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
