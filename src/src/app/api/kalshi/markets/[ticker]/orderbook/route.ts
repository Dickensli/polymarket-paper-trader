import { NextRequest, NextResponse } from 'next/server';
import { getKalshiOrderBook } from '@/lib/kalshi';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  try {
    const { ticker } = await params;
    const rawOutcome = request.nextUrl.searchParams.get('outcome')?.toUpperCase();
    if (rawOutcome !== 'YES' && rawOutcome !== 'NO') {
      return NextResponse.json({ error: 'outcome must be YES or NO' }, { status: 400 });
    }
    const book = await getKalshiOrderBook(ticker, rawOutcome);
    if (!book) return NextResponse.json({ error: 'Order book not available' }, { status: 404 });
    return NextResponse.json(book);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
