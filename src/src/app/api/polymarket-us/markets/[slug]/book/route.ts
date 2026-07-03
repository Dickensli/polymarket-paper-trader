import { NextRequest, NextResponse } from 'next/server';
import { getPolymarketUsMarketBook } from '@/lib/polymarket-us';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const book = await getPolymarketUsMarketBook(slug);
    if (!book) {
      return NextResponse.json({ error: 'Order book not available' }, { status: 404 });
    }
    return NextResponse.json(book);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
