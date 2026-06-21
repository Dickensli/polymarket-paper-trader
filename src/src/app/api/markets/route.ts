// =============================================================================
// GET /api/markets — List active prediction markets
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getMarkets } from '@/lib/polymarket';
import { PolymarketApiError } from '@/lib/polymarket';
import { withCache } from '@/lib/cache';

/**
 * Fetch a paginated list of active markets from Polymarket.
 *
 * Query params:
 *  - `limit`    (number, default 20, max 100)
 *  - `offset`   (number, default 0)
 *  - `category` (string, optional — client-side filter)
 *  - `search`   (string, optional — client-side filter on question text)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    // Parse and clamp query parameters
    const rawLimit = parseInt(searchParams.get('limit') ?? '20', 10);
    const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20), 100);

    const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

    const category = searchParams.get('category')?.trim() || undefined;
    const search = searchParams.get('search')?.trim().toLowerCase() || undefined;

    // Fetch the top 500 active markets (cached for 30 seconds)
    const allMarkets = await withCache(
      'markets:master-list',
      30_000, // 30 second cache
      () => getMarkets({ limit: 500, closed: false }),
    );

    let filteredMarkets = allMarkets;

    // Apply category filter
    if (category) {
      filteredMarkets = filteredMarkets.filter(
        (m) => m.category?.toLowerCase() === category.toLowerCase(),
      );
    }

    // Apply search query filter
    if (search) {
      filteredMarkets = filteredMarkets.filter(
        (m) =>
          m.question.toLowerCase().includes(search) ||
          (m.description?.toLowerCase().includes(search) ?? false),
      );
    }

    // Slice for pagination
    const totalCount = filteredMarkets.length;
    const paginatedMarkets = filteredMarkets.slice(offset, offset + limit);

    return NextResponse.json({
      data: paginatedMarkets,
      meta: {
        limit,
        offset,
        total: totalCount,
        count: paginatedMarkets.length,
        ...(category && { category }),
        ...(search && { search }),
      },
    });
  } catch (err) {
    if (err instanceof PolymarketApiError) {
      return NextResponse.json(
        { error: 'Failed to fetch markets', details: err.message },
        { status: err.statusCode ?? 502 },
      );
    }

    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
