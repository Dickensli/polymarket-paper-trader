import { NextRequest, NextResponse } from 'next/server';
import { getPolymarketUsMarkets } from '@/lib/polymarket-us';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const params: Record<string, unknown> = {};
    if (searchParams.has('limit')) params.limit = Number(searchParams.get('limit'));
    if (searchParams.has('offset')) params.offset = Number(searchParams.get('offset'));
    if (searchParams.has('active')) params.active = searchParams.get('active') === 'true';
    if (searchParams.has('closed')) params.closed = searchParams.get('closed') === 'true';

    const data = await getPolymarketUsMarkets(params);
    if (!data) {
      return NextResponse.json({ error: 'Failed to fetch markets' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
