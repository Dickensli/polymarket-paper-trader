import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy route for Kalshi candlesticks API.
 * Proxies to: https://external-api.kalshi.com/trade-api/v2/markets/{ticker}/candlesticks
 *
 * Query params:
 *   - period_interval: minutes per candle (1, 60, 1440)
 *   - start_ts: start unix timestamp (seconds)
 *   - end_ts: end unix timestamp (seconds)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const { searchParams } = new URL(request.url);

  // Build query string from allowed params
  const allowedParams = ['period_interval', 'start_ts', 'end_ts'];
  const queryParts: string[] = [];
  for (const key of allowedParams) {
    const value = searchParams.get(key);
    if (value) {
      queryParts.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

  const url = `https://external-api.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}/candlesticks${queryString}`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      next: { revalidate: 60 }, // Cache for 60 seconds
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Kalshi API returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('Kalshi candlesticks proxy error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch candlestick data from Kalshi' },
      { status: 502 }
    );
  }
}
