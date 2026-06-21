// =============================================================================
// GET /api/markets/[id] — Single market with full details
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getMarket, getOrderBook, getMidpoint } from '@/lib/polymarket';
import { PolymarketApiError } from '@/lib/polymarket';
import { withCache } from '@/lib/cache';

/**
 * Fetch a single market by ID, enriched with live pricing and order book data.
 *
 * Returns the normalized market plus:
 *  - `midpoints`: { YES: number, NO: number } from the CLOB API
 *  - `orderBook`: full order book for the YES token
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Market ID is required' },
        { status: 400 },
      );
    }

    // Fetch market first
    const market = await withCache(`market:${id}`, 15_000, () => getMarket(id));

    // Fetch live pricing data in parallel (best-effort)
    const [yesTokenId, noTokenId] = market.tokenIds;

    const enrichment = await Promise.allSettled([
      yesTokenId ? getMidpoint(yesTokenId) : Promise.resolve(0),
      noTokenId ? getMidpoint(noTokenId) : Promise.resolve(0),
      yesTokenId ? getOrderBook(yesTokenId) : Promise.resolve(null),
    ]);

    const yesMidpoint =
      enrichment[0].status === 'fulfilled' ? enrichment[0].value : null;
    const noMidpoint =
      enrichment[1].status === 'fulfilled' ? enrichment[1].value : null;
    const orderBook =
      enrichment[2].status === 'fulfilled' ? enrichment[2].value : null;

    return NextResponse.json({
      data: {
        ...market,
        midpoints: {
          YES: yesMidpoint,
          NO: noMidpoint,
        },
        orderBook,
      },
    });
  } catch (err) {
    if (err instanceof PolymarketApiError) {
      const status = err.statusCode === 404 ? 404 : (err.statusCode ?? 502);
      return NextResponse.json(
        { error: 'Failed to fetch market', details: err.message },
        { status },
      );
    }

    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
