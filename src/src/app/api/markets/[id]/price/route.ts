// =============================================================================
// GET /api/markets/[id]/price — Live price for a specific market
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getMarket, getMidpoint, getSpread, getLastTradePrice } from '@/lib/polymarket';
import { PolymarketApiError } from '@/lib/polymarket';

/**
 * Fetch the current price data for a market.
 *
 * Returns midpoints, spreads, and last trade prices for both YES and NO tokens.
 * This is a lightweight endpoint designed for frequent polling by the frontend.
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

    // First get the market to resolve token IDs
    const market = await getMarket(id);
    const [yesTokenId, noTokenId] = market.tokenIds;

    if (!yesTokenId) {
      return NextResponse.json(
        { error: 'Market has no token IDs — pricing unavailable' },
        { status: 404 },
      );
    }

    // Fetch all pricing data in parallel
    const results = await Promise.allSettled([
      getMidpoint(yesTokenId),
      noTokenId ? getMidpoint(noTokenId) : Promise.resolve(0),
      getSpread(yesTokenId),
      noTokenId ? getSpread(noTokenId) : Promise.resolve(0),
      getLastTradePrice(yesTokenId),
      noTokenId
        ? getLastTradePrice(noTokenId)
        : Promise.resolve({ price: 0, side: 'UNKNOWN' }),
    ]);

    const value = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
      r.status === 'fulfilled' ? r.value : fallback;

    return NextResponse.json({
      data: {
        marketId: id,
        yes: {
          tokenId: yesTokenId,
          midpoint: value(results[0], 0),
          spread: value(results[2], 0),
          lastTradePrice: value(results[4], { price: 0, side: 'UNKNOWN' }),
        },
        no: {
          tokenId: noTokenId ?? null,
          midpoint: value(results[1], 0),
          spread: value(results[3], 0),
          lastTradePrice: value(results[5], { price: 0, side: 'UNKNOWN' }),
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof PolymarketApiError) {
      const status = err.statusCode === 404 ? 404 : (err.statusCode ?? 502);
      return NextResponse.json(
        { error: 'Failed to fetch price', details: err.message },
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
