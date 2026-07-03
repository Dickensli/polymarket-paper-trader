import { NextRequest, NextResponse } from 'next/server';
import { searchPolymarketUs } from '@/lib/polymarket-us';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const params: Record<string, unknown> = {};
    if (searchParams.has('query')) params.query = searchParams.get('query');
    if (searchParams.has('limit')) params.limit = Number(searchParams.get('limit'));
    if (searchParams.has('status')) params.status = searchParams.get('status');
    if (searchParams.has('page')) params.page = Number(searchParams.get('page'));

    const data = await searchPolymarketUs(params);
    if (!data) {
      return NextResponse.json({ error: 'Search failed' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
